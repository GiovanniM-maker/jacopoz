-- =====================================================================
-- 0075 — Le due carte «per te» della Home non hanno mai funzionato
--
-- Misurato oggi, per un lettore con quattordici libri sullo scaffale:
--
--   get_reco_by_availability(gratis)   29.977 ms
--   get_reco_by_availability(pagati)   15.629 ms
--
-- `authenticated` ha `statement_timeout = 8s`. Quindi quelle due carte **non
-- sono mai arrivate a nessuno che abbia uno scaffale**: la query veniva
-- cancellata e il client riceveva una lista vuota, senza errore. Per il
-- visitatore anonimo andava «solo» 4.601 ms, sotto il limite di 3s di `anon`
-- per un soffio no — anche lì non arrivava.
--
-- --------------------------------------------------------------------
-- Le due cause, distinte
-- --------------------------------------------------------------------
-- **1) Il vettore in una variabile.** L'ordinamento era
-- `b.embedding <=> v_taste` con `v_taste` variabile plpgsql: il piano generico
-- in cache ignora `books_embedding_halfvec_hnsw` e ricade su una scansione
-- sequenziale, calcolando la distanza su tutte le 33.526 righe candidate. È
-- **lo stesso difetto già documentato in 0047**, dove misurammo 1010 ms contro
-- 6 ms per la stessa sonda; `get_recommendations` era già stata corretta con
-- `execute format` e il letterale inlinato, questa no. Qui si allinea.
--
-- **2) Nessun indice per il caso senza gusto.** Quando `v_taste` è nullo
-- (visitatore anonimo, o lettore appena iscritto) l'ordinamento è per
-- popolarità, e non c'era un indice che lo servisse: 1.465 ms solo per leggere
-- la tabella da disco. `books_free_read_idx` esisteva ma non combaciava —
-- l'espressione di popolarità non è nell'indice, e la sua condizione
-- `cover_url is not null` non è fra quelle chieste dalla query. Aveva **zero
-- utilizzi** da quando esiste.
-- =====================================================================

-- --------------------------------------------------------------------
-- Indici per il ramo senza vettore di gusto
-- --------------------------------------------------------------------
-- L'espressione va scritta identica a quella nella query, altrimenti il
-- pianificatore non la riconosce. I quattro contatori sono `not null default 0`,
-- quindi la somma non è mai nulla e l'ordine dei null non entra in gioco.
create index if not exists books_free_pop_idx on public.books
  (((reads_count * 3 + saves_count * 2 + likes_count * 2 + reviews_count)) desc)
  where free_read_url is not null;

-- Per il ramo a pagamento la prima chiave è l'anno, la popolarità è spareggio.
create index if not exists books_paid_recent_idx on public.books
  ((coalesce(published_year, 0)) desc,
   ((reads_count * 3 + saves_count * 2 + likes_count * 2 + reviews_count)) desc)
  where gutenberg_id is null;

-- Due indici che non hanno mai servito una query: 2 MB e 40 kB che occupano
-- posto in 224 MB di shared_buffers, dove il set di lavoro già non ci sta.
drop index if exists public.books_free_read_idx;
drop index if exists public.books_external_rating_idx;

-- --------------------------------------------------------------------
-- La funzione
-- --------------------------------------------------------------------
-- Il valore predefinito va ripetuto: `create or replace` non può togliere i
-- valori predefiniti di una funzione esistente, e ometterlo qui sarebbe stato
-- un `drop`+`create` con una finestra in cui la Home non ha la funzione.
create or replace function public.get_reco_by_availability(p_free boolean, p_limit int default 15)
returns setof public.book_card
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_user  uuid := auth.uid();
  v_taste extensions.vector(512);
  v_cand  uuid[];
begin
  -- Vettore di gusto: media degli embedding dei libri che il lettore ha amato,
  -- letto o votato alto.
  select avg(b.embedding) into v_taste
  from public.user_books ub
  join public.books b on b.id = ub.book_id
  where ub.user_id = v_user
    and b.embedding is not null
    and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4);

  if v_taste is not null then
    -- Il letterale inlinato è ciò che rende questa una sonda sull'indice e non
    -- una scansione: vedi 0047. Il filtro di disponibilità sta **dentro** la
    -- sonda, così l'indice continua a pescare finché non ha abbastanza righe
    -- che lo soddisfano, invece di scartarne metà dopo.
    execute format(
      'select array_agg(s.id order by s.rn) from ('
      || 'select b.id, row_number() over () as rn from public.books b '
      || 'where b.embedding is not null and %s '
      || 'order by (b.embedding::extensions.halfvec(512)) '
      || '<=> %L::extensions.halfvec(512) limit 400) s',
      case when p_free then 'b.free_read_url is not null'
                       else 'b.gutenberg_id is null' end,
      v_taste::extensions.halfvec(512)::text
    ) into v_cand;
  end if;

  if v_cand is not null and array_length(v_cand, 1) > 0 then
    -- L'ordine per gusto è già quello dei candidati: si conserva con
    -- `array_position` invece di ricalcolare 400 distanze.
    return query
    select b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
           b.categories, public.book_avg_rating(b) as avg_rating,
           b.reads_count, b.saves_count, b.likes_count, b.reviews_count
    from public.books b
    where b.id = any(v_cand)
      and not exists (select 1 from public.user_books ub
                      where ub.user_id = v_user and ub.book_id = b.id)
      and not exists (select 1 from public.book_dismissals d
                      where d.user_id = v_user and d.book_id = b.id)
    order by array_position(v_cand, b.id)
    limit greatest(p_limit, 0);
  else
    -- Nessun gusto ancora: popolarità (e per i pagati prima l'anno), servite
    -- dai due indici parziali qui sopra.
    return query
    select b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
           b.categories, public.book_avg_rating(b) as avg_rating,
           b.reads_count, b.saves_count, b.likes_count, b.reviews_count
    from public.books b
    where (case when p_free then b.free_read_url is not null
                            else b.gutenberg_id is null end)
      and not exists (select 1 from public.user_books ub
                      where ub.user_id = v_user and ub.book_id = b.id)
      and not exists (select 1 from public.book_dismissals d
                      where d.user_id = v_user and d.book_id = b.id)
    order by
      case when p_free then 0 else coalesce(b.published_year, 0) end desc,
      (b.reads_count * 3 + b.saves_count * 2 + b.likes_count * 2 + b.reviews_count) desc
    limit greatest(p_limit, 0);
  end if;
end;
$$;
revoke execute on function public.get_reco_by_availability(boolean, int) from public;
grant execute on function public.get_reco_by_availability(boolean, int) to anon, authenticated;

analyze public.books;

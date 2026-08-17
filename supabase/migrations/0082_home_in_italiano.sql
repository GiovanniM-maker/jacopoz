-- =====================================================================
-- 0082 — La Home e i consigli in italiano, la ricerca no
--
-- Richiesta: «Home e consigli solo in italiano, ricerca che trova tutto».
--
-- Perché la separazione e non un filtro unico: il catalogo ha 69.029 libri, di
-- cui 8.401 in italiano (12%) e 33.526 leggibili gratis, ma solo **1.020** sono
-- entrambe le cose. Un filtro duro applicato anche alla ricerca ridurrebbe il
-- catalogo visibile a un ottavo e toglierebbe il GRATIS al 97% dei casi. Le
-- vetrine in italiano e la ricerca aperta danno le due cose insieme: chi apre
-- l'app vede italiano, chi cerca «Better di Carrie Leighton» lo trova.
--
-- --------------------------------------------------------------------
-- Il predicato è scritto a mano ogni volta, e non è pigrizia
-- --------------------------------------------------------------------
-- `b.language = 'it'`, inlinato. Non una funzione `per_mercato_italiano()`:
-- questo predicato finisce dentro **predicati di indice parziale**, e lì deve
-- corrispondere carattere per carattere a quello della query. La lezione di
-- 0075, 0078, 0080 e 0081 — quattro indici che sembravano servire una query e
-- non la servivano — è che l'indirezione, qui, è il modo in cui un indice
-- smette silenziosamente di essere usato.
--
-- Quanto è affidabile `language`? Misurato in entrambe le direzioni:
--
--   titoli con marcatori esclusivi dell'italiano (gli/degli/dello/nella/perché)
--     classificati 'it'          482
--     classificati altro          29     → 94% di precisione in inclusione
--
--   le prime 25 righe della classifica sotto il filtro: 23 su 25 italiane
--   (le due eccezioni sono edizioni che tengono il titolo originale)
--
-- I 201 libri con `language is null` restano **fuori**: ammetterli farebbe
-- entrare libri stranieri senza far entrare nulla di italiano.
--
-- Cosa resta da mostrare, misurato prima di scrivere il filtro:
--
--   in italiano con copertina                       6.992
--   con copertina e anno (nuove uscite)             6.273
--   gratis, con copertina                             998
--   brevi (40–200 pagine)                             175
--   categorie con almeno 4 libri (su 19)               19
--
-- Nessuna riga della Home scende sotto la soglia di quattro carte che il client
-- richiede per mostrarla. Era la cosa da verificare prima: un filtro che svuota
-- metà della Home non la traduce, la cancella.
--
-- --------------------------------------------------------------------
-- La parte che avrebbe rotto tutto in silenzio: la sonda vettoriale
-- --------------------------------------------------------------------
-- `get_recommendations`, `get_reco_by_availability` e una delle sezioni della
-- Home scelgono i candidati con una sonda HNSW. Aggiungere un filtro al 12%
-- dentro una sonda HNSW **non** restringe la ricerca nel grafo: pgvector
-- percorre il grafo per `ef_search` nodi e poi scarta le righe che non passano
-- il filtro. Misurato, chiedendo 400 candidati con `ef_search = 100`:
--
--   vettore di gusto italiano  («Il gattopardo»)       93 righe   5,7 ms
--   vettore di gusto inglese   («The Great Gatsby»)    18 righe   5,7 ms
--   vettore di gusto inglese   («Living in the Light»)  2 righe   4,2 ms
--
-- pgvector 0.8.2 ha la scansione iterativa, che continua a percorrere il grafo
-- finché il filtro non ha prodotto abbastanza righe. Stessi vettori:
--
--   ef 100, iterative_scan = relaxed_order   400 righe   17 – 46 ms
--
-- **Cosa compra davvero, verificato con un A/B sulla funzione vera invece che
-- sulla sonda isolata.** La prima stesura di questo commento diceva che senza la
-- scansione iterativa «Consigliati per te» passava da venti libri a due. È
-- falso, e l'errore era di aver misurato un pezzo e concluso sull'insieme:
-- cambiando solo la clausola SET delle due funzioni e rimisurando, la riga resta
-- piena in tutti e due i casi —
--
--   get_recommendations      iterative off  20 righe  220 ms   relaxed  20 righe  260 ms
--   get_reco_by_availability iterative off  15 righe   25 ms   relaxed  15 righe   24 ms
--
-- — perché `get_recommendations` mescola anche 300 libri per popolarità e
-- `get_reco_by_availability` di righe ne mostra 15. Quello che la scansione
-- iterativa compra non è la riga piena: è il **serbatoio semantico** da cui si
-- scelgono quei quindici o venti, 400 candidati invece di 2–18. Senza,
-- «Consigliati per te» per un lettore con la libreria in inglese sarebbe stata
-- una riga piena scelta quasi solo per popolarità, cioè la classifica con un
-- altro titolo. Trenta millisecondi.
--
-- Dove invece il serbatoio è l'unica fonte la differenza si vede eccome: la
-- sezione «Perché hai letto…» non ha nessun ripiego per popolarità, e su cinque
-- semi e quattro lettori veri viene resa 18 volte su 18.
--
-- `relaxed_order` e non `strict_order`: l'ordine esatto per distanza non serve a
-- nessuna delle tre. `get_recommendations` ripunteggia i candidati con cinque
-- segnali e poi li diversifica, `get_reco_by_availability` ne mostra 15 su 400.
--
-- Una misura che non si è riprodotta, scritta perché non venga ritrovata e
-- attribuita alla cosa sbagliata: subito dopo aver applicato questa migrazione,
-- `get_recommendations` per il lettore senza libri italiani misurava 3.273 e
-- 4.576 ms. Sembrava una regressione da 13×. Rimisurata dieci minuti dopo,
-- 259 ms stabili. Erano i tre indici appena ricostruiti e l'ANALYZE che non
-- erano ancora in cache, su un'istanza con 224 MB di shared_buffers e un set di
-- lavoro che non ci sta.
--
-- La clausola sta nell'intestazione della funzione e non nel corpo: dentro una
-- funzione non-VOLATILE il SET è vietato (0047).
--
-- --------------------------------------------------------------------
-- Una sonda che chiedeva 400 candidati e ne riceveva 40
-- --------------------------------------------------------------------
-- `get_reco_by_availability` (0075) non ha mai avuto la clausola
-- `SET hnsw.ef_search`: il valore predefinito è 40, quindi la sua sonda chiedeva
-- `limit 400` e riceveva quaranta righe. È lo stesso difetto che 0047 aveva
-- trovato e corretto in `get_recommendations`, ricomparso in una funzione
-- scritta dopo — un indizio che la correzione era stata applicata al punto e non
-- alla classe. Con il filtro italiano in più (gratis ∧ italiano = 1,4% del
-- catalogo) sarebbe diventato scoperto. Si aggiunge qui.
--
-- --------------------------------------------------------------------
-- Una sezione della Home che non ha mai mostrato niente a nessuno
-- --------------------------------------------------------------------
-- Misurando quante righe sopravvivono al filtro è venuto fuori un difetto che
-- col filtro non c'entra:
--
--   external_rating popolato su          245 libri su 69.029   (0,35%)
--   external_ratings_count massimo       575
--
--   «Acclamati dai lettori di tutto il mondo»
--     external_rating >= 4.2 and external_ratings_count >= 500  →  0 libri
--
-- Quella sezione non ha mai reso una carta, per nessun lettore, da quando
-- esiste. E non era vuota-e-innocua: le cinque specifiche si estraggono **a
-- sorte** dal serbatoio, quindi una specifica morta bruciava uno dei cinque
-- posti e il lettore vedeva quattro righe. Viene rimossa.
--
-- Restano nel serbatoio editoriale «Classici da leggere gratis» (1.020 libri
-- italiani), «Brevi» (175) e «Piccole gemme» (6 — pochi, ma sono sei libri
-- davvero ben votati e poco noti, che è esattamente ciò che il titolo promette).
--
-- Lo stesso dato spiega un secondo difetto, e questo si vedeva: le righe per
-- tema, i classici gratis e i brevi erano **ordinati** per
-- `external_rating * ln(2 + conteggio)`, che è zero per il 99,65% del catalogo.
-- Una chiave che pareggia sempre non è una chiave: l'ordine effettivo era quello
-- che restituiva la scansione, e il seme — che quelle righe dovrebbe far ruotare
-- a ogni visita — moltiplicava zero, quindi non ruotavano. Si ordina per
-- qualcosa che il catalogo ha davvero: prima i libri con una sinossi (345 in
-- italiano, cioè quelli che hanno qualcosa da leggere sotto la copertina), poi
-- la rotazione col seme.
--
-- --------------------------------------------------------------------
-- Cosa NON viene filtrato, e perché
-- --------------------------------------------------------------------
--   search_books           la richiesta è esplicita: «ricerca che trova tutto»
--   get_continue_reading   sono i libri che il lettore ha già aperto; filtrarli
--                          vorrebbe dire nascondergli un libro che sta leggendo
--   get_similar_books      è ancorata al libro che il lettore ha aperto: se ha
--                          aperto un libro inglese, «Simili a questo» in solo
--                          italiano risponde a una domanda che non ha fatto
--   get_book_editions      le edizioni sono le edizioni
--   la schermata di genere navigare un genere è più vicino a cercare che a
--                          guardare una vetrina (la Home ha la sua riga di
--                          genere, e quella è filtrata)
--
-- Anche il **vettore di gusto** non è filtrato, in nessuna delle tre funzioni:
-- si costruisce su tutta la libreria del lettore, libri stranieri compresi. Ciò
-- che ha amato dice cosa gli piace; la lingua dice cosa gli si mostra.
-- =====================================================================

-- --------------------------------------------------------------------
-- Perché la prima riga eseguibile è un calcolo di distanza buttato via
-- --------------------------------------------------------------------
-- Senza di essa questa migrazione **non si applica**:
--
--   ERROR: 42501: permission denied to set parameter "hnsw.ef_search"
--
-- I parametri `hnsw.*` vengono registrati dalla libreria di pgvector quando
-- viene caricata nel backend. Finché non lo è, per Postgres sono segnaposto, e
-- impostare un segnaposto — anche solo nell'intestazione di una funzione —
-- richiede il superutente, che su Supabase il ruolo `postgres` non è.
--
-- Una connessione appena aperta che esegue soltanto DDL non tocca mai un vettore
-- e quindi non carica la libreria. Un'operazione qualsiasi sul tipo la carica.
-- 0047 e 0037 hanno funzionato per caso, su una connessione che aveva già
-- lavorato: il caso non è una condizione, quindi qui è scritto.
select ('[1,0,0]'::extensions.vector(3) <=> '[0,1,0]'::extensions.vector(3)) as carica_pgvector;

-- --------------------------------------------------------------------
-- Gli indici: il predicato parziale segue il filtro
-- --------------------------------------------------------------------
-- Un indice parziale il cui predicato non contiene `language = 'it'` non può
-- servire una query che lo filtra.

-- Classifica: serbatoio dei primi 120 per popolarità.
drop index if exists public.books_trending_pop_idx;
create index books_trending_pop_idx on public.books
  (((reads_count + saves_count + likes_count + reviews_count)) desc, created_at desc)
  where cover_url is not null and language = 'it';

-- «Gratis, consigliati per te», ramo senza vettore di gusto.
drop index if exists public.books_free_pop_idx;
create index books_free_pop_idx on public.books
  (((reads_count * 3 + saves_count * 2 + likes_count * 2 + reviews_count)) desc)
  where free_read_url is not null and language = 'it';

-- Nuove uscite. Questa la interroga il client via PostgREST, non una funzione:
-- l'indice cambia nello stesso commit in cui il client comincia a filtrare, ma
-- non nello stesso istante — nella finestra di un deploy la riga costa una
-- scansione in più. `idx_scan` su questo indice va ricontrollato dopo, che è la
-- lezione di 0081: l'indice creato su una diagnosi sbagliata non aveva servito
-- nemmeno una query, e `idx_scan` era la colonna che lo diceva.
drop index if exists public.books_new_releases_idx;
create index books_new_releases_idx on public.books
  (published_year desc)
  where published_year is not null and language = 'it';

-- --------------------------------------------------------------------
-- get_recommendations — «Consigliati per te» e la coda infinita
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_recommendations(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_seed integer DEFAULT 0)
 RETURNS SETOF public.book_reco
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET "hnsw.ef_search" TO '100'
 SET "hnsw.iterative_scan" TO 'relaxed_order'
AS $function$
declare
  v_user    uuid := auth.uid();
  v_taste   extensions.vector(512);
  v_cand    uuid[] := '{}';
  v_ids     uuid[];
  v_scores  numeric[];
  v_reasons text[];
  v_embs    extensions.vector(512)[];
  v_n       int;
  v_slate   int := 72;   -- deterministic slate size; pages slice into this
  v_cap     int;
  v_explore int;
  v_sel     int[] := '{}';
  v_best    int;
  v_bestval numeric;
  v_val     numeric;
  v_maxsim  numeric;
  i         int;
  j         int;
  step      int;
begin
  -- NB: no SET LOCAL in the body — Postgres forbids SET inside a non-volatile
  -- function, and this one is STABLE. ef_search is raised via the function's
  -- own SET clause above instead.

  select avg(b.embedding) into v_taste
  from public.books b
  join public.user_books ub on ub.book_id = b.id
  where ub.user_id = v_user
    and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
    and b.embedding is not null;

  -- Bounded candidate set. v_taste is a PL/pgSQL variable, so the ORDER BY is
  -- index-scannable (this is what turns a 67k seq scan into an index probe).
  -- The vector must be inlined as a literal: with a plain PL/pgSQL variable the
  -- cached generic plan ignores books_embedding_halfvec_hnsw and falls back to a
  -- sequential scan. Measured on this catalogue: parameter 1010 ms vs
  -- literal 6 ms for the identical top-400 probe.
  if v_taste is not null then
    execute format(
      'select array_agg(s.id) from ('
      || 'select b.id from public.books b where b.embedding is not null '
      || 'and b.language = ''it'' '
      || 'order by (b.embedding::extensions.halfvec(512)) '
      || '<=> %L::extensions.halfvec(512) limit 400) s',
      v_taste::extensions.halfvec(512)::text
    ) into v_cand;
  end if;

  -- Always mix in strong popular/well-rated books so the non-semantic signals
  -- (genre, author, collaborative, popularity) have material to rank, and so a
  -- brand-new user with no taste vector still gets a full slate.
  select coalesce(v_cand, '{}') || coalesce(array_agg(s.id), '{}') into v_cand
  from (
    select b.id from public.books b
    where b.cover_url is not null and b.language = 'it'
    -- Lo spareggio era `coalesce(external_rating, 0) desc`, su una colonna
    -- popolata sullo 0,35% del catalogo: inerte come criterio, e sufficiente a
    -- rendere l'espressione diversa da books_trending_pop_idx.
    order by (b.reads_count + b.saves_count + b.likes_count + b.reviews_count) desc,
             b.created_at desc
    limit 300
  ) s;

  if v_cand is null or array_length(v_cand, 1) is null then return; end if;

  with
  cand as materialized (select distinct unnest(v_cand) as id),
  my_books as materialized (
    select ub.book_id, ub.liked, ub.status, ub.rating
    from public.user_books ub where ub.user_id = v_user
  ),
  my_positive as materialized (
    select book_id from my_books
    where liked or status = 'read' or coalesce(rating, 0) >= 4
  ),
  my_genres as materialized (
    select genre_slug as g from public.user_genre_prefs where user_id = v_user
    union
    select unnest(b.categories) from public.books b
      join my_positive p on p.book_id = b.id
  ),
  my_authors as materialized (
    select distinct unnest(b.authors) as a
    from public.books b join my_positive p on p.book_id = b.id
  ),
  neighbours as materialized (
    select ub.user_id, count(*)::numeric as overlap
    from public.user_books ub
    join my_positive p on p.book_id = ub.book_id
    where ub.user_id <> v_user
      and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
    group by ub.user_id
    order by overlap desc
    limit 50
  ),
  collab as materialized (
    select ub.book_id, sum(n.overlap) as collab_raw
    from public.user_books ub
    join neighbours n on n.user_id = ub.user_id
    where (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
    group by ub.book_id
  ),
  max_collab as (select greatest(coalesce(max(collab_raw), 1), 1) as m from collab),
  max_pop as (
    select greatest(coalesce(max(b.reads_count + b.saves_count + b.likes_count), 1), 1)::numeric as m
    from public.books b join cand c on c.id = b.id
  ),
  max_ext as (
    select greatest(coalesce(max((coalesce(b.external_rating,0)/5.0)
      * ln((1 + coalesce(b.external_ratings_count,0))::numeric)), 1), 1) as m
    from public.books b join cand c on c.id = b.id
  ),
  scored as (
    select
      b.id, b.embedding,
      (select count(*) from unnest(b.categories) cc where cc in (select g from my_genres))::numeric
        / greatest(coalesce(array_length(b.categories, 1), 1), 1) as genre_aff,
      (exists (
        select 1 from unnest(b.authors) a where a in (select a from my_authors)
      ))::int::numeric as author_aff,
      coalesce((select collab_raw from collab c2 where c2.book_id = b.id), 0)
        / (select m from max_collab) as collab_aff,
      greatest(
        (b.reads_count + b.saves_count + b.likes_count)::numeric / (select m from max_pop),
        ((coalesce(b.external_rating, 0) / 5.0)
          * ln((1 + coalesce(b.external_ratings_count, 0))::numeric)) / (select m from max_ext)
      ) as pop_aff,
      case
        when b.embedding is not null and v_taste is not null
        then greatest(0, 1 - (b.embedding <=> v_taste))::numeric
        else 0
      end as semantic_aff
    from public.books b
    join cand c on c.id = b.id
    where b.id not in (select book_id from my_books)
      and b.id not in (select book_id from public.book_dismissals where user_id = v_user)
  ),
  ranked as (
    select
      s.id, s.embedding,
      round(0.30 * s.semantic_aff + 0.25 * s.genre_aff + 0.15 * s.author_aff +
            0.15 * s.collab_aff + 0.15 * s.pop_aff, 4)
      -- Seeded jitter (deterministic per book+seed, capped so it reorders
      -- peers rather than promoting weak matches over strong ones).
      + (abs(hashtext(s.id::text || ':' || p_seed::text)) % 1000)::numeric / 1000 * 0.12
        as score,
      case
        when s.semantic_aff >= 0.55 then 'Vicino ai libri che ami'
        when s.author_aff > 0 then 'Dagli autori che ami'
        when s.collab_aff > 0 then 'Popolare tra lettori come te'
        when s.genre_aff > 0 then 'Nei tuoi generi preferiti'
        else 'Di tendenza su Tomo'
      end as reason
    from scored s
  )
  select array_agg(t.id order by t.score desc),
         array_agg(t.score order by t.score desc),
         array_agg(t.reason order by t.score desc),
         array_agg(t.embedding order by t.score desc)
  into v_ids, v_scores, v_reasons, v_embs
  from (select * from ranked order by score desc limit 200) t;

  if v_ids is null then return; end if;
  v_n := array_length(v_ids, 1);

  -- One deterministic MMR slate per (user, seed) — independent of p_offset, so
  -- consecutive pages are disjoint instead of re-deriving a shifted order.
  v_slate := least(v_slate, v_n);
  v_cap := least(v_n, v_slate + 20);

  for step in 1..v_slate loop
    v_best := null; v_bestval := null;
    for i in 1..v_cap loop
      if not (i = any(v_sel)) then
        v_maxsim := 0;
        if v_embs[i] is not null then
          foreach j in array v_sel loop
            if v_embs[j] is not null then
              v_val := 1 - (v_embs[i] <=> v_embs[j]);
              if v_val > v_maxsim then v_maxsim := v_val; end if;
            end if;
          end loop;
        end if;
        v_val := 0.7 * v_scores[i] - 0.3 * v_maxsim;
        if v_bestval is null or v_val > v_bestval then
          v_bestval := v_val; v_best := i;
        end if;
      end if;
    end loop;
    exit when v_best is null;
    v_sel := v_sel || v_best;
  end loop;

  -- Exploration slots only on the first page, so they don't repeat while
  -- scrolling. Rotated by the seed.
  v_explore := case when v_taste is not null and p_limit >= 10 and greatest(p_offset, 0) = 0
                    then greatest(1, p_limit / 10) else 0 end;

  return query
  select
    b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
    b.categories,
    case when b.rating_count > 0
         then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
    b.reads_count, b.saves_count, b.likes_count, b.reviews_count,
    v_scores[s.idx], v_reasons[s.idx]
  from unnest(
         v_sel[(greatest(p_offset, 0) + 1):(greatest(p_offset, 0) + greatest(p_limit, 0) - v_explore)]
       ) with ordinality as s(idx, ord)
  join public.books b on b.id = v_ids[s.idx]
  order by s.ord;

  if v_explore > 0 then
    return query
    select
      b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
      b.categories,
      case when b.rating_count > 0
           then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
      b.reads_count, b.saves_count, b.likes_count, b.reviews_count,
      0.05::numeric, 'Qualcosa di diverso'::text
    -- Reuse the candidate set already in memory. Scanning the whole catalogue
    -- here was the single biggest cost in this function (a full 67k-row cosine
    -- scan with no usable index, seconds per call).
    from public.books b
    join (select distinct unnest(v_cand) as id) c on c.id = b.id
    where b.embedding is not null
      and b.cover_url is not null
      and greatest(0, 1 - (b.embedding <=> v_taste)) < 0.35
      and b.id not in (select ub.book_id from public.user_books ub where ub.user_id = v_user)
      and b.id not in (select bd.book_id from public.book_dismissals bd where bd.user_id = v_user)
    order by
      (coalesce(b.external_rating, 3) / 5.0)
        * (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000)::numeric / 1000 desc
    limit v_explore;
  end if;
end;
$function$;

revoke execute on function public.get_recommendations(int, int, int) from public;
grant execute on function public.get_recommendations(int, int, int) to authenticated;

-- --------------------------------------------------------------------
-- get_reco_by_availability — «Gratis, consigliati per te»
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_reco_by_availability(p_free boolean, p_limit integer DEFAULT 15)
 RETURNS SETOF public.book_card
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET "hnsw.ef_search" TO '100'
 SET "hnsw.iterative_scan" TO 'relaxed_order'
AS $function$
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
      || 'where b.embedding is not null and b.language = ''it'' and %s '
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
    where b.language = 'it'
      and (case when p_free then b.free_read_url is not null
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
$function$;

revoke execute on function public.get_reco_by_availability(boolean, int) from public;
grant execute on function public.get_reco_by_availability(boolean, int) to anon, authenticated;

-- --------------------------------------------------------------------
-- get_trending_seeded — «Top 10 su Tomo oggi»
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_trending_seeded(p_limit integer DEFAULT 20, p_seed integer DEFAULT 0)
 RETURNS SETOF public.book_card
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  with pool as (
    select b.*, (b.reads_count + b.saves_count + b.likes_count + b.reviews_count) as pop
    from public.books b
    where b.cover_url is not null and b.language = 'it'
    order by pop desc, b.created_at desc
    limit 120
  )
  select
    p.id, p.title, p.subtitle, p.authors, p.cover_url, p.published_year, p.categories,
    case when p.rating_count > 0
         then round(p.rating_sum::numeric / p.rating_count, 2) else null end,
    p.reads_count, p.saves_count, p.likes_count, p.reviews_count
  from pool p
  order by p.pop * (0.6 + (abs(hashtext(p.id::text || ':' || p_seed::text)) % 1000)::numeric / 1000 * 0.8) desc
  limit greatest(p_limit, 0);
$function$;

revoke execute on function public.get_trending_seeded(int, int) from public;
grant execute on function public.get_trending_seeded(int, int) to anon, authenticated;

-- --------------------------------------------------------------------
-- get_home_sections — le righe con un nome
-- --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_home_sections(p_seed integer DEFAULT 0, p_max_sections integer DEFAULT 5, p_per_section integer DEFAULT 12)
 RETURNS TABLE(section_key text, section_title text, section_rank integer, id uuid, title text, subtitle text, authors text[], cover_url text, published_year integer, categories text[], avg_rating numeric, reads_count integer, saves_count integer, likes_count integer, reviews_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 -- La sonda di `similar_to_book` ha lo stesso problema delle altre due: il
 -- vettore è quello di UN libro, e se il lettore ha amato un libro inglese i
 -- suoi vicini in italiano dentro ef_search sono pochissimi.
 SET "hnsw.ef_search" TO '100'
 SET "hnsw.iterative_scan" TO 'relaxed_order'
AS $function$
declare
  v_user  uuid := auth.uid();
  v_specs jsonb := '[]'::jsonb;
  v_spec  jsonb;
  v_rank  int := 0;
  v_emb   text;
begin
  -- Anchor books: things the reader demonstrably liked, rotated by the seed so
  -- "Perché hai letto…" isn't always about the same book.
  v_specs := v_specs || (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'similar_to_book', 'ref', b.id::text,
             'title', 'Perché hai letto ' || b.title)), '[]'::jsonb)
    from (
      select b.id, b.title
      from public.books b
      join public.user_books ub on ub.book_id = b.id
      where ub.user_id = v_user
        and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
        and b.embedding is not null
      order by abs(hashtext(b.id::text || ':' || p_seed::text))
      limit 3
    ) b
  );

  -- Authors they rated highly.
  v_specs := v_specs || (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'more_by_author', 'ref', a.author,
             'title', 'Ancora ' || a.author)), '[]'::jsonb)
    from (
      select distinct unnest(b.authors) as author
      from public.books b
      join public.user_books ub on ub.book_id = b.id
      where ub.user_id = v_user
        and (ub.liked or coalesce(ub.rating, 0) >= 4)
      order by 1
      limit 6
    ) a
    where a.author is not null
  );

  -- Dominant themes from the reader's taste clusters / explicit prefs.
  v_specs := v_specs || (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'theme', 'ref', t.cat,
             'title', 'Il tuo filone: ' || public.genre_label(t.cat))), '[]'::jsonb)
    from (
      select unnest(b.categories) as cat
      from public.books b
      join public.user_taste_clusters tc on tc.medoid_book_id = b.id
      where tc.user_id = v_user
      union
      select genre_slug from public.user_genre_prefs where user_id = v_user
      limit 8
    ) t
    where t.cat is not null
  );

  -- Editorial angles that stay meaningful without personal history.
  v_specs := v_specs || jsonb_build_array(
    jsonb_build_object('kind', 'free_classics', 'ref', '', 'title', 'Classici da leggere gratis, ora'),
    jsonb_build_object('kind', 'short_reads',   'ref', '', 'title', 'Brevi: finiscili in una sera'),
    jsonb_build_object('kind', 'hidden_gems',   'ref', '', 'title', 'Piccole gemme da scoprire')
  );

  -- Pick and order the rows for this seed.
  for v_spec in
    select s.spec from (
      select value as spec
      from jsonb_array_elements(v_specs) value
      order by abs(hashtext((value->>'kind') || (value->>'ref') || ':' || p_seed::text))
      limit greatest(p_max_sections, 1)
    ) s
  loop
    v_rank := v_rank + 1;

    if v_spec->>'kind' = 'similar_to_book' then
      -- Semantic neighbours of the anchor book. The vector is inlined so the
      -- HNSW index is used (a bound parameter falls back to a seq scan).
      select b.embedding::extensions.halfvec(512)::text into v_emb
        from public.books b where b.id = (v_spec->>'ref')::uuid;
      if v_emb is null then continue; end if;
      return query execute format($q$
        select %L::text, %L::text, %s::int,
               b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
               case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
               b.reads_count, b.saves_count, b.likes_count, b.reviews_count
        from public.books b
        where b.embedding is not null and b.cover_url is not null and b.language = 'it'
          and b.id <> %L::uuid
          and not exists (select 1 from public.user_books ub where ub.user_id = %L::uuid and ub.book_id = b.id)
        order by (b.embedding::extensions.halfvec(512)) <=> %L::extensions.halfvec(512)
        limit %s
      $q$, v_spec->>'kind' || ':' || (v_spec->>'ref'), v_spec->>'title', v_rank,
           v_spec->>'ref', v_user, v_emb, p_per_section);

    elsif v_spec->>'kind' = 'more_by_author' then
      return query
      select (v_spec->>'kind') || ':' || (v_spec->>'ref'), v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where (v_spec->>'ref') = any(b.authors)
        and b.cover_url is not null and b.language = 'it'
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      order by (b.reads_count + b.likes_count + b.saves_count) desc, b.published_year desc nulls last
      limit p_per_section;

    elsif v_spec->>'kind' = 'theme' then
      return query
      select (v_spec->>'kind') || ':' || (v_spec->>'ref'), v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where (v_spec->>'ref') = any(b.categories)
        and b.cover_url is not null and b.language = 'it'
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      -- L'ordinamento era `external_rating * ln(2 + conteggio)`, zero per il
      -- 99,65% del catalogo: una chiave che pareggia sempre non è una chiave, e
      -- il seme moltiplicava zero, quindi la riga non ruotava affatto. Prima i
      -- libri che hanno una sinossi da leggere sotto la copertina (345 in
      -- italiano), poi la rotazione col seme.
      order by (b.synopsis is not null) desc,
               (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000) desc
      limit p_per_section;

    elsif v_spec->>'kind' = 'free_classics' then
      return query
      select v_spec->>'kind', v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where b.free_read_url is not null and b.cover_url is not null and b.language = 'it'
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      -- L'ordinamento era `external_rating * ln(2 + conteggio)`, zero per il
      -- 99,65% del catalogo: una chiave che pareggia sempre non è una chiave, e
      -- il seme moltiplicava zero, quindi la riga non ruotava affatto. Prima i
      -- libri che hanno una sinossi da leggere sotto la copertina (345 in
      -- italiano), poi la rotazione col seme.
      order by (b.synopsis is not null) desc,
               (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000) desc
      limit p_per_section;

    elsif v_spec->>'kind' = 'short_reads' then
      return query
      select v_spec->>'kind', v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where b.page_count between 40 and 200 and b.cover_url is not null and b.language = 'it'
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      -- L'ordinamento era `external_rating * ln(2 + conteggio)`, zero per il
      -- 99,65% del catalogo: una chiave che pareggia sempre non è una chiave, e
      -- il seme moltiplicava zero, quindi la riga non ruotava affatto. Prima i
      -- libri che hanno una sinossi da leggere sotto la copertina (345 in
      -- italiano), poi la rotazione col seme.
      order by (b.synopsis is not null) desc,
               (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000) desc
      limit p_per_section;

    else -- hidden_gems: well rated but not yet mainstream
      return query
      select v_spec->>'kind', v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where coalesce(b.external_rating, 0) >= 4.0
        and coalesce(b.external_ratings_count, 0) between 20 and 400
        and b.cover_url is not null and b.language = 'it'
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      order by (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000) desc
      limit p_per_section;
    end if;
  end loop;
end;
$function$;

revoke execute on function public.get_home_sections(int, int, int) from public;
grant execute on function public.get_home_sections(int, int, int) to authenticated;

-- --------------------------------------------------------------------
-- Le due letture in cache: stesso filtro, e il contenuto vecchio buttato
-- --------------------------------------------------------------------
-- Restano inutilizzate — «metti gli indici, lascia la cache inutilizzata» — ma
-- devono restare vere: se un giorno vengono collegate non devono servire una
-- vetrina non filtrata, scritta oggi.

CREATE OR REPLACE FUNCTION public.get_new_releases_cached(p_limit integer DEFAULT 20)
 RETURNS SETOF public.book_card
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  c_key   constant text := 'catalog:new_releases';
  v_cache jsonb;
begin
  -- Il ripiego è dentro il `begin ... exception`: se lo store è illeggibile per
  -- qualunque motivo — permessi, tabella in migrazione, lock — la lettura non
  -- deve fallire, deve solo diventare non-cache. È il requisito «graceful
  -- fallback», che qui non è verso un altro sistema ma verso la strada lunga.
  begin
    v_cache := public.internal_cache_get(c_key);
  exception when others then
    v_cache := null;
  end;

  if v_cache is not null then
    return query
    select (r ->> 'id')::uuid, r ->> 'title', r ->> 'subtitle',
           array(select jsonb_array_elements_text(r -> 'authors')),
           r ->> 'cover_url', (r ->> 'published_year')::smallint,
           array(select jsonb_array_elements_text(r -> 'categories')),
           (r ->> 'avg_rating')::numeric,
           (r ->> 'reads_count')::int, (r ->> 'saves_count')::int,
           (r ->> 'likes_count')::int, (r ->> 'reviews_count')::int
    from jsonb_array_elements(v_cache) as r
    limit greatest(p_limit, 0);
    return;
  end if;

  -- Miss: si calcola, si restituisce, e si scrive per il prossimo. Si mette in
  -- cache una finestra più larga del limite chiesto (60), così un client che
  -- chiede 20 e un altro che ne chiede 40 condividono la stessa riga.
  create temp table if not exists _nr (
    id uuid, title text, subtitle text, authors text[], cover_url text,
    published_year smallint, categories text[], avg_rating numeric,
    reads_count int, saves_count int, likes_count int, reviews_count int
  ) on commit drop;
  delete from _nr;

  insert into _nr
  select b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
         b.categories, public.book_avg_rating(b),
         b.reads_count, b.saves_count, b.likes_count, b.reviews_count
  from public.books b
  where b.published_year is not null and b.language = 'it'
  order by b.published_year desc
  limit 60;

  begin
    perform public.internal_cache_put(
      c_key, (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from _nr t), interval '1 hour');
  exception when others then
    null;   -- non poter scrivere in cache non è un motivo per non rispondere
  end;

  return query select * from _nr limit greatest(p_limit, 0);
end;
$function$;

revoke execute on function public.get_new_releases_cached(int) from public;
grant execute on function public.get_new_releases_cached(int) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_trending_cached(p_limit integer DEFAULT 20, p_seed integer DEFAULT 0)
 RETURNS SETOF public.book_card
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  c_key   constant text := 'catalog:trending';
  v_cache jsonb;
begin
  begin
    v_cache := public.internal_cache_get(c_key);
  exception when others then
    v_cache := null;   -- store illeggibile: si va per la strada lunga
  end;

  if v_cache is null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'title', p.title, 'subtitle', p.subtitle, 'authors', p.authors,
             'cover_url', p.cover_url, 'published_year', p.published_year,
             'categories', p.categories, 'avg_rating', public.book_avg_rating(p),
             'reads_count', p.reads_count, 'saves_count', p.saves_count,
             'likes_count', p.likes_count, 'reviews_count', p.reviews_count,
             'pop', p.reads_count + p.saves_count + p.likes_count + p.reviews_count
           ) order by (p.reads_count + p.saves_count + p.likes_count + p.reviews_count) desc,
             p.created_at desc), '[]'::jsonb)
      into v_cache
    from (
      select b.* from public.books b
      where b.cover_url is not null and b.language = 'it'
      order by (b.reads_count + b.saves_count + b.likes_count + b.reviews_count) desc,
               b.created_at desc
      limit 120
    ) p;

    begin
      perform public.internal_cache_put(c_key, v_cache, interval '1 hour');
    exception when others then
      null;
    end;
  end if;

  -- Il mescolamento sta fuori dalla cache, ed è la ragione per cui la cache
  -- funziona: la parte condivisa è il serbatoio, non l'ordine.
  return query
  select (r ->> 'id')::uuid, r ->> 'title', r ->> 'subtitle',
         array(select jsonb_array_elements_text(r -> 'authors')),
         r ->> 'cover_url', (r ->> 'published_year')::smallint,
         array(select jsonb_array_elements_text(r -> 'categories')),
         (r ->> 'avg_rating')::numeric,
         (r ->> 'reads_count')::int, (r ->> 'saves_count')::int,
         (r ->> 'likes_count')::int, (r ->> 'reviews_count')::int
  from jsonb_array_elements(v_cache) as r
  order by (r ->> 'pop')::numeric
           * (0.6 + (abs(hashtext((r ->> 'id') || ':' || p_seed::text)) % 1000)::numeric / 1000 * 0.8) desc
  limit greatest(p_limit, 0);
end;
$function$;

revoke execute on function public.get_trending_cached(int, int) from public;
grant execute on function public.get_trending_cached(int, int) to anon, authenticated;

-- Le due righe in cache scritte prima del filtro descrivono un catalogo che non
-- esiste più: si buttano, non si aspetta la scadenza.
delete from public.cache_entries where key in ('catalog:new_releases', 'catalog:trending');

-- Gli indici sono nuovi e il planner non ha statistiche sulla combinazione
-- (language, popolarità). 0069 è la migrazione in cui una colonna appena
-- aggiunta e filtrata subito ha fatto stimare 121 righe su 68.675 e scegliere un
-- nested loop da cinque secondi.
analyze public.books;

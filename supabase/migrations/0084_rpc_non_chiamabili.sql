-- =====================================================================
-- 0084 — Quattro RPC che il lettore non poteva chiamare, e la posizione di
--        lettura che non veniva salvata
--
-- Nessuno di questi difetti c'entra col filtro italiano. Sono venuti fuori
-- mentre provavo un controllo nella direzione del guasto: per verificare che il
-- nuovo controllo H-7a segnalasse davvero una riga non filtrata, l'ho puntato su
-- `get_similar_books` — che è volutamente non filtrata — e invece di una riga di
-- libri stranieri ho avuto un 42501.
--
-- Da lì ho chiamato **una per una** tutte le 31 RPC che il client usa, con
-- l'identità di un lettore vero. La differenza fra leggere il codice e chiamare
-- la funzione è tutta qui: nessuna di queste quattro si vede leggendo, perché il
-- permesso manca su una colonna, non sulla funzione.
--
-- Due delle quattro sono mie, di 0071. Il difetto della posizione di lettura è
-- di 0023 e ha tre settimane di dati a dimostrarlo.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. La posizione di lettura, che non veniva salvata da tre settimane
-- --------------------------------------------------------------------
-- `case when ... then 'read' else 'reading' end` ha entrambi i rami di tipo
-- sconosciuto, quindi Postgres risolve l'espressione a `text` — e assegnarla a
-- una colonna `shelf_status` è un errore 42804. Non a volte: sempre, dal 0023.
--
-- Il ramo colpito è `p_percent >= 3 and < 90`, cioè **un lettore a metà di un
-- libro**. I letterali sciolti negli `insert ... values` non hanno il problema
-- (un letterale solo si converte), quindi al 95% funziona e al 40% no.
--
-- Il primo `insert` sta nella stessa funzione, quindi l'errore annulla anche
-- quello: non si salva niente. E il client scarta l'errore
-- (`saveReadProgress` è un try/catch «best-effort»), quindi la chiamata torna
-- senza lamentarsi.
--
-- I dati lo confermano, e sono la ragione per cui questo non è un difetto
-- teorico:
--
--   book_read_progress            15 righe, dal 24 luglio al 17 agosto
--     percent fra 3 e 89           0
--     percent >= 90                0
--     percent < 3                 15
--
-- Tre settimane di letture in cui la posizione non è mai stata registrata oltre
-- il 2%. Chi ha letto mezzo libro e ha riaperto l'app lo ha ritrovato all'inizio.

CREATE OR REPLACE FUNCTION public.save_read_progress(p_book_id uuid, p_percent numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  insert into public.book_read_progress (user_id, book_id, percent, updated_at)
  values (v_user, p_book_id, greatest(0, least(100, p_percent)), now())
  on conflict (user_id, book_id) do update
    set percent = greatest(public.book_read_progress.percent, excluded.percent),
        updated_at = now();

  if p_percent >= 90 then
    insert into public.user_books (user_id, book_id, status, started_at, finished_at)
    values (v_user, p_book_id, 'read', now(), now())
    on conflict (user_id, book_id) do update
      set status = 'read', finished_at = coalesce(public.user_books.finished_at, now());
  elsif p_percent >= 3 then
    insert into public.user_books (user_id, book_id, status, started_at)
    values (v_user, p_book_id, 'reading', now())
    on conflict (user_id, book_id) do update
      -- Il cast è la correzione: senza, il `case` è `text` e l'assegnazione
      -- a `shelf_status` falla.
      set status = (case when public.user_books.status = 'read' then 'read'
                         else 'reading' end)::public.shelf_status,
          started_at = coalesce(public.user_books.started_at, now());
  end if;
end;
$function$;


-- --------------------------------------------------------------------
-- 2. Quattro RPC che il lettore non può chiamare
-- --------------------------------------------------------------------
-- 0059 ha revocato `select` su `books` e ridato i permessi **colonna per
-- colonna**: 28 colonne su 47. Da allora una funzione che non sia
-- `security definer` falla con 42501 se tocca
--
--   • una colonna non concessa — `embedding`, e `work_id`, che 0070 ha aggiunto
--     senza aggiungerla all'elenco;
--   • la **riga intera**, perché `public.book_avg_rating(b)` passa il record e
--     un riferimento a riga intera richiede il `select` sulla tabella.
--
-- Verificato chiamando come `authenticated` tutte le 31 RPC che il client usa,
-- una per una. Quattro falliscono:
--
--   get_my_review        legge b.work_id     → il compositore di recensioni
--   upsert_review        legge b.work_id     → **salvare una recensione**
--   get_similar_books    legge b.embedding   → «Simili a questo» sulla scheda
--   get_trending_books   riga intera         → nessun chiamante nel client
--
-- Le prime due sono una regressione di 0071, la migrazione che ha spostato le
-- recensioni sull'opera: da allora nessun lettore può scrivere una recensione.
-- Le altre due vengono da 0059.
--
-- La correzione è la stessa che hanno già tutte le funzioni sorelle:
-- `security definer` con un `search_path` fissato. Su `upsert_review` questo
-- toglie di mezzo la RLS, e va detto perché è sicuro: **ogni** scrittura è
-- vincolata ad `auth.uid()` — l'update colpisce la riga trovata con
-- `user_id = auth.uid()`, l'insert scrive `auth.uid()` — quindi la funzione non
-- può toccare la recensione di qualcun altro nemmeno sbagliando i parametri.

CREATE OR REPLACE FUNCTION public.get_my_review(p_book_id uuid)
 RETURNS public.reviews
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.* from public.reviews r
  join public.books b on b.id = p_book_id
  where r.user_id = auth.uid() and r.work_id = b.work_id
  limit 1;
$function$;

grant execute on function public.get_my_review(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.upsert_review(p_book_id uuid, p_body text, p_rating smallint DEFAULT NULL::smallint, p_spoilers boolean DEFAULT false)
 RETURNS public.reviews
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_work uuid;
  v_esistente uuid;
  v_out public.reviews;
begin
  select b.work_id into v_work from public.books b where b.id = p_book_id;
  if v_work is null then
    raise exception 'libro inesistente';
  end if;

  select r.id into v_esistente
  from public.reviews r
  where r.user_id = auth.uid() and r.work_id = v_work;

  if v_esistente is not null then
    -- Si aggiorna anche `book_id`: se il lettore sta scrivendo dall'edizione
    -- che ha davvero in mano, è quella che va registrata.
    update public.reviews
       set body = p_body, rating = p_rating,
           contains_spoilers = coalesce(p_spoilers, false),
           book_id = p_book_id
     where id = v_esistente
    returning * into v_out;
  else
    insert into public.reviews (user_id, book_id, body, rating, contains_spoilers)
    values (auth.uid(), p_book_id, p_body, p_rating, coalesce(p_spoilers, false))
    returning * into v_out;
  end if;

  return v_out;
end;
$function$;

revoke execute on function public.upsert_review(uuid, text, smallint, boolean) from anon;
grant execute on function public.upsert_review(uuid, text, smallint, boolean) to authenticated;

CREATE OR REPLACE FUNCTION public.get_similar_books(p_book_id uuid, p_limit integer DEFAULT 12)
 RETURNS SETOF public.book_card
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select
    b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
    b.categories, public.book_avg_rating(b) as avg_rating,
    b.reads_count, b.saves_count, b.likes_count, b.reviews_count
  from public.books b
  where b.embedding is not null
    and b.id <> p_book_id
  order by b.embedding <=> (select embedding from public.books where id = p_book_id)
  limit greatest(p_limit, 0)
$function$;

grant execute on function public.get_similar_books(uuid, int) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_trending_books(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS SETOF public.book_card
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
    b.categories, public.book_avg_rating(b) as avg_rating,
    b.reads_count, b.saves_count, b.likes_count, b.reviews_count
  from public.books b
  order by
    (b.reads_count * 3 + b.saves_count * 2 + b.likes_count * 2 + b.reviews_count)
      * (1.0 + (coalesce(b.published_year, 0) >= extract(year from now())::int - 3)::int * 0.25) desc,
    b.reviews_count desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$function$;

grant execute on function public.get_trending_books(int, int) to anon, authenticated;

-- --------------------------------------------------------------------
-- Perché questo non deve poter tornare
-- --------------------------------------------------------------------
-- Il buco non era in nessuna di queste cinque funzioni: era che **niente
-- chiamava le RPC come lettore**. `spec-test.py` guadagna un controllo che le
-- chiama tutte (S-6) e uno che verifica che la posizione di lettura sopravviva a
-- un salvataggio a metà libro (B-7); `check-silent-errors.py` impara a vedere
-- anche `await supabase.rpc(...)` senza `error`, che è la forma con cui
-- `saveReadProgress` ha nascosto il suo errore per tre settimane.

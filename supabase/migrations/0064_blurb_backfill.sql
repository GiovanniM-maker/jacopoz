-- =====================================================================
-- 0064 — Recuperare le descrizioni, che sono il vero collo di bottiglia
--
-- 0063 ha stabilito che senza materiale la sinossi non si scrive. Restava il
-- fatto: 692 libri su 68.817 avevano materiale, l'1%. Questo lo alza.
--
-- La fonte attuale è Wikipedia, cercata per titolo + autore, e si vede: per i
-- classici restituisce l'incipit della voce enciclopedica («X è un romanzo di
-- Y, pubblicato nel...») che dice cos'è il libro e non cosa ci succede dentro,
-- e quando la ricerca sbaglia articolo non se ne accorge nessuno — a «The trey
-- of spades» era finito addosso un elenco di insulti etnici.
--
-- Google Books restituisce la quarta di copertina dell'editore. Misurato su 40
-- libri veri del catalogo presi in ordine di priorità: **32 su 40** ne hanno
-- una utilizzabile, contro l'1% di oggi. Fra questi «Oblivion» di Wallace, il
-- libro a cui il modello aveva attribuito la trama di «Infinite Jest».
--
-- Il ritmo è dettato dalla quota giornaliera dell'API, non dal database:
-- 8 libri ogni 20 minuti sono ~576 libri e ~900 chiamate al giorno. Alzando la
-- quota in Cloud Console si può alzare il lotto senza toccare altro.
-- =====================================================================

alter table public.books
  add column if not exists blurb_source text,
  add column if not exists blurb_checked_at timestamptz,
  add column if not exists blurb_attempts int not null default 0;

comment on column public.books.blurb_source is
  'Da dove viene source_blurb_internal: google_books:isbn, google_books:titolo, '
  'oppure null per il materiale storico (Wikipedia o ingest).';
comment on column public.books.blurb_attempts is
  'Ricerche concluse senza descrizione utilizzabile. A 2 il libro esce dalla coda.';

-- --------------------------------------------------------------------
-- La coda
-- --------------------------------------------------------------------
-- Stesso ordinamento della coda delle sinossi: prima i libri che qualcuno ha
-- davvero aperto o messo sullo scaffale. Con 68.000 candidati e ~576 al giorno
-- l'ordine è tutto — la differenza fra "fra tre giorni i libri che contano
-- hanno una scheda" e "fra quattro mesi le ha il catalogo".
create or replace function public.internal_blurb_queue(p_limit int default 8)
returns table (id uuid, title text, authors text[], isbn_13 text, language text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with visti as (
    select coalesce(e.props ->> 'bookId', e.props ->> 'book_id')::uuid as bid, count(*)::int n
    from public.analytics_events e
    where coalesce(e.props ->> 'bookId', e.props ->> 'book_id') ~ '^[0-9a-f-]{36}$'
    group by 1
  ),
  scaffale as (
    select ub.book_id as bid, count(*)::int n
    from public.user_books ub group by 1
  )
  select b.id, b.title, b.authors, b.isbn_13, b.language
  from public.books b
  left join visti v on v.bid = b.id
  left join scaffale s on s.bid = b.id
  where length(coalesce(b.source_blurb_internal, '')) < 100
    and b.blurb_attempts < 2
    -- Un libro già cercato senza esito si riprova fra tre mesi: le schede su
    -- Google Books si arricchiscono nel tempo, ma non in una settimana.
    and (b.blurb_checked_at is null or b.blurb_checked_at < now() - interval '90 days')
  order by
    (coalesce(case when v.n > 0 then 1000 + least(v.n, 500) else 0 end, 0)
     + coalesce(case when s.n > 0 then 500 + least(s.n * 50, 400) else 0 end, 0)
     + case when b.cover_url is not null then 50 else 0 end
     + least((b.reads_count + b.saves_count + b.likes_count + b.reviews_count) * 5, 200)
     -- Con l'ISBN la ricerca è esatta e non rischia di prendere il libro
     -- sbagliato: a parità di interesse, prima quelli.
     + case when b.isbn_13 is not null then 30 else 0 end
     - b.blurb_attempts * 300
    ) desc, b.id
  limit greatest(p_limit, 0);
$$;
revoke execute on function public.internal_blurb_queue(int) from public, anon, authenticated;
grant execute on function public.internal_blurb_queue(int) to service_role;

/** Ricerca conclusa senza descrizione utilizzabile. Il conteggio lo tiene il
 *  database per lo stesso motivo dei tentativi di sinossi: due lotti
 *  sovrapposti che leggono e riscrivono perderebbero un tentativo. */
create or replace function public.internal_blurb_not_found(p_book_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.books
     set blurb_attempts = blurb_attempts + 1,
         blurb_checked_at = now()
   where id = p_book_id;
$$;
revoke execute on function public.internal_blurb_not_found(uuid) from public, anon, authenticated;
grant execute on function public.internal_blurb_not_found(uuid) to service_role;

-- --------------------------------------------------------------------
-- Il dispatch
-- --------------------------------------------------------------------
-- Con la sola chiave di dispatch la funzione risponde 401 prima ancora di
-- essere eseguita: il gateway Edge controlla il JWT a monte del codice. Serve
-- anche la anon key come Authorization. Costato un pomeriggio su `synopsis`,
-- con cron che intanto segnava "succeeded".
create or replace function public.internal_blurb_dispatch()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_anon   text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'synopsis_dispatch_secret';
  select decrypted_secret into v_anon
  from vault.decrypted_secrets where name = 'anon_key';
  if v_secret is null or v_anon is null then return; end if;

  perform net.http_post(
    url     := 'https://tpphaalfmcqtfxhyafzz.supabase.co/functions/v1/blurbs',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_anon,
                 'x-dispatch-secret', v_secret),
    body    := jsonb_build_object('batch', 8),
    timeout_milliseconds := 180000
  );
end;
$$;
revoke execute on function public.internal_blurb_dispatch() from public, anon, authenticated;

-- Sfasato rispetto a `synopsis-backfill` (*/10) e a `enrich-enqueue` (3-59/5):
-- sono tre lavori che fanno chiamate esterne lente, e non c'è motivo di farli
-- partire nello stesso minuto. (Un libro senza materiale non rischia comunque
-- di finire nella coda delle sinossi: 0063 lo esclude a monte.)
select cron.schedule('blurb-backfill', '5-59/20 * * * *',
  $$select public.internal_blurb_dispatch()$$);

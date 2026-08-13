-- =====================================================================
-- 0058 — W2, primo passo: separare la sinossi che mostriamo dal testo di terzi
--
-- Oggi la scheda libro stampa `books.description`, che è la quarta di copertina
-- scritta dall'editore e arrivata dai provider. È testo altrui pubblicato
-- verbatim, e va tolto dalla vista. Solo 699 libri su 68.817 ce l'hanno, quindi
-- il costo di toglierlo è quasi nullo — e resta comunque prezioso come **input
-- di analisi**, che la legge consente (art. 70-quater/70-septies: l'eccezione
-- copre estrazione e analisi, non la ripubblicazione).
--
-- Da qui in poi ci sono due campi con due destini diversi:
--
--   source_blurb_internal  il testo dell'editore. Mai esposto. Serve a generare
--                          la sinossi e a nutrire l'embedding.
--   synopsis               quello che il lettore legge: o licenziato, o scritto
--                          da noi e **dichiarato** come generato.
--
-- La rinomina è deliberata: costringe ogni consumatore a dichiarare quale dei
-- due vuole, invece di ereditare `description` per abitudine.
--
-- La revoca dei privilegi di lettura su `source_blurb_internal` **non** è in
-- questa migrazione: il client in produzione fa ancora `select("*")` e una
-- revoca lo romperebbe all'istante. Arriva subito dopo, quando il bundle nuovo
-- è online. Nel frattempo il campo non è più raggiungibile per nome dal codice.
-- =====================================================================

alter table public.books rename column description to source_blurb_internal;

comment on column public.books.source_blurb_internal is
  'Quarta di copertina dell''editore, dai provider. INPUT DI ANALISI: non va mai '
  'esposta da nessuna API pubblica né mostrata all''utente. Vedi docs/PIANO-IMPLEMENTAZIONE.md W2.';

alter table public.books
  add column if not exists synopsis text,
  -- 'publisher' = licenziata dalla fonte ufficiale; 'ai' = scritta da noi.
  add column if not exists synopsis_source text
    check (synopsis_source in ('publisher', 'ai')),
  add column if not exists synopsis_model text,
  add column if not exists synopsis_prompt_version text,
  add column if not exists synopsis_generated_at timestamptz,
  -- Da cosa è stata scritta: serve a rigenerare in massa quando cambia il
  -- modello, e a rispondere se qualcuno chiede conto di una frase.
  add column if not exists synopsis_inputs text[];

comment on column public.books.synopsis is
  'La sinossi che il lettore legge. Con synopsis_source = ''ai'' l''interfaccia '
  'DEVE dichiararlo in modo visibile.';

-- Una sinossi generata senza sapere da quale modello non si può rigenerare né
-- difendere: il vincolo lo rende impossibile per costruzione.
alter table public.books drop constraint if exists books_synopsis_provenance;
alter table public.books add constraint books_synopsis_provenance check (
  synopsis is null
  or (synopsis_source = 'publisher')
  or (synopsis_source = 'ai' and synopsis_model is not null
      and synopsis_prompt_version is not null and synopsis_generated_at is not null)
);

-- Coda di generazione: si riempie per priorità, si svuota per merito.
create index if not exists books_synopsis_todo_idx
  on public.books (id) where synopsis is null;

-- --------------------------------------------------------------------
-- L'embedding legge la sinossi vera, e ripiega sul testo dell'editore
-- --------------------------------------------------------------------
-- Misurato prima di toccarlo: la lunghezza mediana dell'input di un embedding è
-- **66 caratteri**, e il 56% dei libri sta sotto i 70 — cioè titolo, autore e
-- due slug di genere. A quella lunghezza il segnale dominante non è il
-- contenuto del libro ma il nome dell'autore e l'ortografia della lingua, ed è
-- il motivo per cui i 200 filoni calcolati finora raggruppano per autore e per
-- lingua. Con le sinossi l'input diventa dieci volte più lungo, e a quel punto
-- gli embedding vanno ricalcolati (vedi RE-EMB nel piano).
create or replace function public.book_embedding_text(b public.books)
returns text
language sql
immutable
as $$
  select left(
    coalesce(b.title, '') || ' — ' ||
    array_to_string(b.authors, ', ') || '. ' ||
    array_to_string(b.categories, ', ') || '. ' ||
    coalesce(b.synopsis, b.source_blurb_internal, ''),
    1500)
$$;

-- --------------------------------------------------------------------
-- Che cosa è ancora da scrivere, e in che ordine
-- --------------------------------------------------------------------
/**
 * La coda delle sinossi mancanti, ordinata per merito.
 *
 * 68.000 sinossi non si generano in un batch, e non serve: con sei utenti
 * attivi la stragrande maggioranza di questi libri non la guarderà nessuno per
 * mesi. L'ordine è quello che porta prima la percentuale *percepita* da 1% a
 * quasi tutto:
 *
 *   1. i libri che qualcuno ha davvero aperto (analytics_events)
 *   2. quelli che qualcuno ha messo sullo scaffale o recensito
 *   3. quelli che compaiono in vetrina: copertina, voti, popolarità
 *   4. il resto, a esaurimento
 */
create or replace function public.internal_synopsis_queue(p_limit int default 50)
returns table (id uuid, title text, authors text[], priorita int)
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- I due segnali si aggregano **prima**: sono tabelle piccole (995 eventi,
  -- poche centinaia di scaffali). La prima versione li cercava con due lateral
  -- correlate per ciascuno dei 68.817 libri e superava gli 8 secondi di
  -- statement_timeout di PostgREST — passava solo dall'API di gestione, che ha
  -- un limite più lungo, quindi in prova sembrava funzionare.
  with visti as (
    -- Il client scrive `bookId`, non `book_id`: leggerne una sola avrebbe reso
    -- il segnale più importante della coda — i libri che qualcuno ha davvero
    -- aperto — invisibile, senza che niente andasse in errore.
    select coalesce(e.props ->> 'bookId', e.props ->> 'book_id')::uuid as bid, count(*)::int n
    from public.analytics_events e
    where coalesce(e.props ->> 'bookId', e.props ->> 'book_id') ~ '^[0-9a-f-]{36}$'
    group by 1
  ),
  scaffale as (
    select ub.book_id as bid, count(*)::int n
    from public.user_books ub group by 1
  )
  select b.id, b.title, b.authors,
    (coalesce(case when v.n > 0 then 1000 + least(v.n, 500) else 0 end, 0)
     + coalesce(case when s.n > 0 then 500 + least(s.n * 50, 400) else 0 end, 0)
     + case when b.cover_url is not null then 50 else 0 end
     + least((b.reads_count + b.saves_count + b.likes_count + b.reviews_count) * 5, 200)
     + least(round(coalesce(b.external_rating, 0) * 10)::int, 50)
    ) as priorita
  from public.books b
  left join visti v on v.bid = b.id
  left join scaffale s on s.bid = b.id
  where b.synopsis is null
  order by priorita desc, b.id
  limit greatest(p_limit, 0);
$$;
revoke execute on function public.internal_synopsis_queue(int) from public, anon, authenticated;
-- --------------------------------------------------------------------
-- La pipeline di arricchimento va riscritta, non solo rinominata la colonna
-- --------------------------------------------------------------------
-- I corpi plpgsql sono testo: Postgres non li riscrive quando si rinomina una
-- colonna, quindi dopo la ALTER questa funzione sarebbe morta al primo giro del
-- cron, in silenzio. Riemessa qui con `source_blurb_internal`. Le occorrenze di
-- "description" che restano sono chiavi JSON di Open Library, non la colonna.
CREATE OR REPLACE FUNCTION public.internal_enrich_ingest()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  j       record;
  v_json  jsonb;
  v_title text;
  v_req   bigint;
  v_other text;
  v_key   text;
  v_desc  text;
  c_ua    constant jsonb := jsonb_build_object('User-Agent', 'TomoBeta/1.0 (book community app)');
begin
  for j in
    select ej.*, resp.status_code, resp.content
    from public.enrich_jobs ej
    join net._http_response resp on resp.id = ej.request_id
  loop
    if j.status_code = 200 then
      v_json := j.content::jsonb;

      if j.kind = 'ol_ratings' then
        update public.books
        set external_rating        = nullif((v_json -> 'docs' -> 0 ->> 'ratings_average'), '')::numeric,
            external_ratings_count = nullif((v_json -> 'docs' -> 0 ->> 'ratings_count'), '')::int
        where id = j.book_id;

        -- Chain to the work JSON for a description (obscure books included).
        v_key := v_json -> 'docs' -> 0 ->> 'key';
        if v_key is not null then
          select net.http_get(
            url := 'https://openlibrary.org' || v_key || '.json',
            headers := c_ua,
            timeout_milliseconds := 20000
          ) into v_req;
          insert into public.enrich_jobs (book_id, kind, request_id)
          values (j.book_id, 'ol_work', v_req);
        end if;

      elsif j.kind = 'ol_work' then
        -- description is either a plain string or { "type": ..., "value": ... }
        v_desc := coalesce(v_json ->> 'description', v_json -> 'description' ->> 'value');
        -- strip Open Library's trailing source footnotes, e.g. "([source][1])"
        v_desc := regexp_replace(coalesce(v_desc, ''), '\s*\(\[.*$', '');
        if length(trim(v_desc)) > 20 then
          update public.books
          set source_blurb_internal = left(trim(v_desc), 1500)
          where id = j.book_id and coalesce(source_blurb_internal, '') = '';
        end if;

      elsif j.kind in ('wiki_search_it', 'wiki_search_en') then
        v_title := v_json -> 'query' -> 'search' -> 0 ->> 'title';
        if v_title is not null then
          select net.http_get(
            url := 'https://' || j.lang || '.wikipedia.org/api/rest_v1/page/summary/'
                   || public.urlencode(replace(v_title, ' ', '_')),
            headers := c_ua,
            timeout_milliseconds := 20000
          ) into v_req;
          insert into public.enrich_jobs (book_id, kind, lang, payload, request_id)
          values (j.book_id, 'wiki_summary', j.lang, v_title, v_req);
        elsif j.kind = 'wiki_search_it' then
          select b2.title || ' ' || coalesce(b2.authors[1], '') into v_other
          from public.books b2 where b2.id = j.book_id;
          select net.http_get(
            url := 'https://en.wikipedia.org/w/api.php?action=query&list=search'
                   || '&format=json&srlimit=1&srsearch=' || public.urlencode(v_other || ' novel'),
            headers := c_ua,
            timeout_milliseconds := 20000
          ) into v_req;
          insert into public.enrich_jobs (book_id, kind, lang, request_id)
          values (j.book_id, 'wiki_search_en', 'en', v_req);
        end if;

      elsif j.kind = 'wiki_summary' then
        if coalesce(v_json ->> 'extract', '') <> ''
           and (v_json ->> 'type') = 'standard'
           and coalesce(v_json ->> 'description', '') !~* '(film|movie|miniserie|tv series|serie tv)' then
          insert into public.external_reviews
            (book_id, source, source_label, excerpt, url, license)
          values (
            j.book_id, 'wikipedia',
            'Wikipedia (' || j.lang || ')',
            left(v_json ->> 'extract', 700),
            v_json -> 'content_urls' -> 'desktop' ->> 'page',
            'CC BY-SA 4.0'
          )
          on conflict (book_id, source) do update
            set excerpt = excluded.excerpt, url = excluded.url, fetched_at = now();

          update public.books
          set source_blurb_internal = left(v_json ->> 'extract', 1500)
          where id = j.book_id and coalesce(source_blurb_internal, '') = '';
        end if;
      end if;
    end if;

    delete from public.enrich_jobs where id = j.id;
  end loop;
end;
$function$;
revoke execute on function public.internal_enrich_ingest() from public, anon, authenticated;

-- `revoke ... from public` toglie l'EXECUTE anche a service_role, che non ha
-- una concessione propria: la Edge Function chiamava la coda e riceveva zero
-- righe senza un errore visibile.
grant execute on function public.internal_synopsis_queue(int) to service_role;

-- --------------------------------------------------------------------
-- Il backfill: piano, e solo per merito
-- --------------------------------------------------------------------
-- Ogni sinossi è una chiamata a pagamento, quindi la porta della modalità
-- batch è chiusa con un segreto che conosce solo questo cron: la anon key è
-- pubblica per costruzione e non può bastare a far spendere soldi.
--
-- Venti libri ogni dieci minuti sono ~2.900 al giorno. Sui 68.000 in coda
-- sarebbero tre settimane, ma non è quello il punto: l'ordine per priorità fa
-- sì che i libri che qualcuno guarda davvero arrivino nelle prime ore, e la
-- generazione a richiesta sulla scheda copre tutto il resto.
create or replace function public.internal_synopsis_dispatch()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'synopsis_dispatch_secret';
  if v_secret is null then return; end if;

  perform net.http_post(
    url     := 'https://tpphaalfmcqtfxhyafzz.supabase.co/functions/v1/synopsis',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-dispatch-secret', v_secret),
    body    := jsonb_build_object('batch', 20),
    timeout_milliseconds := 120000
  );
end;
$$;
revoke execute on function public.internal_synopsis_dispatch() from public, anon, authenticated;

select cron.schedule('synopsis-backfill', '*/10 * * * *',
  $$select public.internal_synopsis_dispatch()$$);

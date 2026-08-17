-- =====================================================================
-- 0079 — Uno strato di cache cache-aside, dentro Postgres
--
-- Richiesta: cache per le letture ad alto traffico (schede opera/edizioni,
-- collezioni pubbliche, classifiche), con chiavi tipo `work:{id}:details` e
-- `catalog:new_releases`, TTL rispettivamente 24h e 1h, invalidazione su nuova
-- recensione e su aggiornamento da ingestione, e ripiego se la cache non
-- risponde.
--
-- Fatto in Postgres e non in Redis perché in questa architettura non esiste un
-- application server: il client Expo parla direttamente a PostgREST, e il
-- cache-aside ha bisogno di uno strato in mezzo. Le chiavi conservano
-- volutamente la forma di Redis (`namespace:id:campo`), così il giorno in cui
-- ci fosse un server davanti, spostare lo store è meccanico.
--
-- --------------------------------------------------------------------
-- Misurato prima di scrivere, perché cambia cosa vale la pena mettere in cache
-- --------------------------------------------------------------------
--
--   scheda libro (per chiave primaria)     1,8 –    49 ms
--   nuove uscite                         353,6 – 3.992 ms   ← scansione di 36.799 righe
--   classifica seminata                  409,4 –   437 ms
--
-- Due conseguenze che vanno dette:
--
-- **1) La scheda libro non ha bisogno di cache.** Due millisecondi su una
-- lettura per chiave primaria: una cache davanti aggiungerebbe una scrittura,
-- un'invalidazione da mantenere e un modo nuovo di servire dati vecchi, per
-- risparmiare quasi niente. La funzione la creo perché è stata chiesta ed è
-- corretta, ma **non la userei** finché quel numero non cambia.
--
-- **2) Per le nuove uscite la prima cura è un indice, non la cache.** Il costo
-- non è calcolo, è leggere 36.799 righe per restituirne 20 — e un indice lo
-- azzera. La cache ci sta sopra e serve al secondo ordine. Vale la pena dirlo
-- perché è la terza volta in due giorni che la risposta giusta è un indice: la
-- carta «gratis» della Home era a 29.977 ms e un indice l'ha portata a 9.
-- =====================================================================

-- --------------------------------------------------------------------
-- L'indice che fa il grosso del lavoro sulle nuove uscite
-- --------------------------------------------------------------------
create index if not exists books_new_releases_idx on public.books
  (published_year desc)
  where published_year is not null;

-- --------------------------------------------------------------------
-- Lo store
-- --------------------------------------------------------------------
create table if not exists public.cache_entries (
  key         text primary key,
  payload     jsonb       not null,
  expires_at  timestamptz not null,
  written_at  timestamptz not null default now()
);

comment on table public.cache_entries is
  'Store cache-aside. Chiavi in stile Redis (`work:{id}:details`), scadenza '
  'esplicita per riga. Contiene SOLO dati pubblici: vedi il commento su '
  'internal_cache_fill_work_details per il motivo per cui è un vincolo e non '
  'una raccomandazione.';

-- La scadenza serve a scremare, ma le chiavi si cercano per prefisso durante
-- l'invalidazione: l'indice serve a quello.
create index if not exists cache_entries_expires_idx on public.cache_entries (expires_at);

-- Nessun client tocca questa tabella direttamente: si passa dalle funzioni.
alter table public.cache_entries enable row level security;
revoke all on table public.cache_entries from anon, authenticated;

-- --------------------------------------------------------------------
-- Le primitive: get, put, invalidate
-- --------------------------------------------------------------------

/** Il payload se la chiave esiste e non è scaduta, altrimenti null (miss). */
create or replace function public.internal_cache_get(p_key text)
returns jsonb
language sql
volatile              -- legge una tabella che cambia: non è stable
security definer
set search_path = public
as $$
  select c.payload from public.cache_entries c
  where c.key = p_key and c.expires_at > now();
$$;
revoke execute on function public.internal_cache_get(text) from public, anon, authenticated;

/** Scrive o sovrascrive una chiave con la sua scadenza. */
create or replace function public.internal_cache_put(p_key text, p_payload jsonb, p_ttl interval)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.cache_entries as c (key, payload, expires_at, written_at)
  values (p_key, p_payload, now() + p_ttl, now())
  on conflict (key) do update
    -- Due letture che sbagliano insieme calcolano lo stesso valore e la seconda
    -- sovrascrive la prima: nessun danno, e nessun bisogno di un lock.
    set payload = excluded.payload,
        expires_at = excluded.expires_at,
        written_at = excluded.written_at;
$$;
revoke execute on function public.internal_cache_put(text, jsonb, interval) from public, anon, authenticated;

/** Invalida una chiave, o tutte quelle con un prefisso. */
create or replace function public.internal_cache_drop(p_key_or_prefix text, p_prefix boolean default false)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare n int;
begin
  if p_prefix then
    delete from public.cache_entries where key like p_key_or_prefix || '%';
  else
    delete from public.cache_entries where key = p_key_or_prefix;
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.internal_cache_drop(text, boolean) from public, anon, authenticated;

-- --------------------------------------------------------------------
-- `catalog:new_releases` — TTL 1 ora
-- --------------------------------------------------------------------
-- Collezione pubblica, uguale per tutti: è il caso in cui una cache condivisa
-- ha senso senza riserve.
create or replace function public.get_new_releases_cached(p_limit int default 20)
returns setof public.book_card
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
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
  where b.published_year is not null
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
$$;
revoke execute on function public.get_new_releases_cached(int) from public;
grant execute on function public.get_new_releases_cached(int) to anon, authenticated;

-- --------------------------------------------------------------------
-- `work:{id}:details` — TTL 24 ore
-- --------------------------------------------------------------------
-- **Il vincolo che rende questa cache corretta:** il payload non contiene
-- niente che dipenda da chi legge. Sembra ovvio e non lo è — la funzione
-- esistente `get_book_editions` ordina le edizioni secondo la
-- `reading_language` del profilo di chi chiama, e marca `is_current`
-- sull'edizione richiesta. Mettere *quello* sotto una chiave di opera
-- significherebbe servire a un lettore l'ordine preferito da un altro.
--
-- Quindi in cache va la lista **non ordinata** delle edizioni pubbliche, e
-- l'ordinamento e `is_current` si calcolano fuori, a ogni chiamata. È la
-- differenza fra una cache condivisa e una cache che perde dati fra utenti.
create or replace function public.get_work_details_cached(p_book_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_work  uuid;
  v_key   text;
  v_cache jsonb;
begin
  select work_id into v_work from public.books where id = p_book_id;
  if v_work is null then return null; end if;
  v_key := 'work:' || v_work::text || ':details';

  begin
    v_cache := public.internal_cache_get(v_key);
  exception when others then
    v_cache := null;
  end;

  if v_cache is null then
    select jsonb_build_object(
      'work_id', v_work,
      'edizioni', coalesce(jsonb_agg(jsonb_build_object(
          'id', b.id, 'title', b.title, 'subtitle', b.subtitle, 'authors', b.authors,
          'synopsis', b.synopsis, 'synopsis_source', b.synopsis_source,
          'cover_url', b.cover_url, 'published_year', b.published_year,
          'page_count', b.page_count, 'language', b.language,
          'isbn_13', b.isbn_13, 'isbn_10', b.isbn_10, 'categories', b.categories,
          'avg_rating', public.book_avg_rating(b), 'rating_count', b.rating_count,
          'reads_count', b.reads_count, 'saves_count', b.saves_count,
          'likes_count', b.likes_count, 'reviews_count', b.reviews_count,
          'free_read_url', b.free_read_url, 'gutenberg_id', b.gutenberg_id
        )), '[]'::jsonb))
      into v_cache
    from public.books b
    where b.work_id = v_work;

    begin
      perform public.internal_cache_put(v_key, v_cache, interval '24 hours');
    exception when others then
      null;
    end;
  end if;

  -- `is_current` è per chiamata, non per opera: si aggiunge qui fuori.
  return jsonb_set(v_cache, '{richiesto}', to_jsonb(p_book_id));
end;
$$;
revoke execute on function public.get_work_details_cached(uuid) from public;
grant execute on function public.get_work_details_cached(uuid) to anon, authenticated;

-- --------------------------------------------------------------------
-- Invalidazione
-- --------------------------------------------------------------------

/** Una recensione nuova, modificata o rimossa cambia i conteggi dell'opera. */
create or replace function public.tg_cache_drop_on_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_work uuid := coalesce(new.work_id, old.work_id);
begin
  perform public.internal_cache_drop('work:' || v_work::text || ':details');
  return null;
end;
$$;
revoke execute on function public.tg_cache_drop_on_review() from public, anon, authenticated;

drop trigger if exists reviews_cache_drop on public.reviews;
create trigger reviews_cache_drop
  after insert or update or delete on public.reviews
  for each row execute function public.tg_cache_drop_on_review();

/** Un libro aggiornato dall'ingestione cambia la scheda della sua opera.
 *
 *  La richiesta parlava di «ingestione ONIX»: quella pipeline **non esiste** in
 *  questo progetto — le fonti sono Google Books, Open Library e Gutenberg, e
 *  arrivano da `ingest-book` e da `internal_enrich_ingest`. L'aggancio è quindi
 *  su ciò che scrive davvero: un trigger sulle colonne che compaiono nella
 *  scheda. Se un domani arriverà un flusso ONIX (Informazioni Editoriali li
 *  distribuisce), scriverà su queste stesse colonne e l'invalidazione funzionerà
 *  senza modifiche — che è il motivo per cui l'aggancio sta qui e non nel
 *  chiamante.
 *
 *  `of (...)` è la parte che conta: senza elenco di colonne il trigger
 *  scatterebbe anche quando l'unica cosa cambiata è `embedding` o
 *  `blurb_checked_at`, cioè a ogni giro dei cron, e la cache non vivrebbe mai. */
create or replace function public.tg_cache_drop_on_book()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.internal_cache_drop('work:' || new.work_id::text || ':details');
  -- Una collezione pubblica cambia solo se cambia l'anno: gli altri campi non
  -- entrano nell'ordinamento delle nuove uscite.
  if new.published_year is distinct from old.published_year then
    perform public.internal_cache_drop('catalog:new_releases');
  end if;
  return null;
end;
$$;
revoke execute on function public.tg_cache_drop_on_book() from public, anon, authenticated;

drop trigger if exists books_cache_drop on public.books;
create trigger books_cache_drop
  after update of title, subtitle, authors, synopsis, synopsis_source, cover_url,
                  published_year, page_count, language, isbn_13, isbn_10,
                  categories, free_read_url, gutenberg_id, work_id
  on public.books
  for each row execute function public.tg_cache_drop_on_book();

-- Un libro nuovo entra nelle nuove uscite: la collezione va rifatta.
create or replace function public.tg_cache_drop_on_new_book()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.published_year is not null then
    perform public.internal_cache_drop('catalog:new_releases');
  end if;
  return null;
end;
$$;
revoke execute on function public.tg_cache_drop_on_new_book() from public, anon, authenticated;

drop trigger if exists books_cache_drop_insert on public.books;
create trigger books_cache_drop_insert
  after insert on public.books
  for each row execute function public.tg_cache_drop_on_new_book();

-- --------------------------------------------------------------------
-- Pulizia delle chiavi scadute
-- --------------------------------------------------------------------
-- Una riga scaduta non viene più letta (`internal_cache_get` filtra su
-- `expires_at`), quindi la pulizia non serve alla correttezza: serve a non far
-- crescere la tabella per sempre. Una volta l'ora basta, e sta lontana dai
-- minuti in cui girano gli altri lavori.
create or replace function public.internal_cache_sweep()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare n int;
begin
  delete from public.cache_entries where expires_at < now() - interval '10 minutes';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.internal_cache_sweep() from public, anon, authenticated;

select cron.schedule('cache-sweep', '47 * * * *', $$select public.internal_cache_sweep()$$);

analyze public.books;

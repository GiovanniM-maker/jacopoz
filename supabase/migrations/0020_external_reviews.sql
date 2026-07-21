-- =====================================================================
-- 0020_external_reviews
-- "Dalla critica": real, attributed external voices per book — never
-- fake community content. O(catalog) by design: max a handful of rows
-- per book (Wikipedia excerpt, aggregate Open Library rating), never
-- other platforms' user reviews (copyright + it would be fake anyway).
--
-- Enrichment follows the catalog philosophy — three circles:
--   1. pre-warm: a nightly cron marks the most visible books;
--   2. on-demand: the app requests enrichment on first book-page view;
--   3. (later) frontier: neighbours of enriched books, low priority.
-- Work happens fully in Postgres via pg_cron + pg_net. Negative caching
-- (enriched_at claim) guarantees each book is attempted once per 90 days
-- no matter how often it is viewed.
-- =====================================================================

alter table public.books
  add column if not exists external_rating        numeric,
  add column if not exists external_ratings_count int,
  add column if not exists enrich_requested_at    timestamptz,
  add column if not exists enriched_at            timestamptz;

create table if not exists public.external_reviews (
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid not null references public.books(id) on delete cascade,
  source       text not null check (source in ('wikipedia', 'nyt', 'openlibrary')),
  source_label text not null,
  excerpt      text not null,
  url          text,
  license      text,
  fetched_at   timestamptz not null default now(),
  unique (book_id, source)
);

alter table public.external_reviews enable row level security;
create policy external_reviews_read on public.external_reviews
  for select using (true);
-- no insert/update policies: written only by the server-side pipeline

-- In-flight enrichment HTTP jobs (pg_net request bookkeeping).
create table if not exists public.enrich_jobs (
  id         bigint generated always as identity primary key,
  book_id    uuid not null references public.books(id) on delete cascade,
  kind       text not null check (kind in
               ('ol_ratings', 'wiki_search_it', 'wiki_search_en', 'wiki_summary')),
  lang       text,
  payload    text,
  request_id bigint not null,
  created_at timestamptz not null default now()
);
alter table public.enrich_jobs enable row level security;  -- server-side only

-- ---------------------------------------------------------------------
-- Percent-encoding helper (Postgres has none built in).
-- ---------------------------------------------------------------------
create or replace function public.urlencode(p text)
returns text
language sql
immutable
as $$
  select string_agg(
    case
      when c ~ '^[A-Za-z0-9_.~-]$' then c
      else upper(regexp_replace(encode(convert_to(c, 'UTF8'), 'hex'), '(..)', '%\1', 'g'))
    end, '')
  from regexp_split_to_table(coalesce(p, ''), '') as c;
$$;

-- ---------------------------------------------------------------------
-- The app calls this on first view of a book page (circle 2).
-- Idempotent and cheap: only stamps the request once.
-- ---------------------------------------------------------------------
create or replace function public.request_book_enrichment(p_book_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.books
  set enrich_requested_at = now()
  where id = p_book_id and enrich_requested_at is null;
$$;

grant execute on function public.request_book_enrichment(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------
-- Enqueue: claim up to 8 requested books per tick, fire OL + Wikipedia
-- lookups. The claim (enriched_at) doubles as the negative cache.
-- ---------------------------------------------------------------------
create or replace function public.internal_enrich_enqueue()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  b       record;
  v_req   bigint;
  v_lang  text;
  v_query text;
  c_ua    constant jsonb := jsonb_build_object('User-Agent', 'TomoBeta/1.0 (book community app)');
begin
  delete from public.enrich_jobs where created_at < now() - interval '1 hour';

  for b in
    select bk.* from public.books bk
    where bk.enrich_requested_at is not null
      and (bk.enriched_at is null or bk.enriched_at < now() - interval '90 days')
    order by bk.enrich_requested_at
    limit 8
  loop
    update public.books set enriched_at = now() where id = b.id;

    -- Open Library aggregate rating: one call, two numbers that summarise
    -- thousands of real opinions without storing any of them.
    v_query := case
      when b.isbn_13 is not null then 'isbn:' || b.isbn_13
      else b.title || ' ' || coalesce(b.authors[1], '')
    end;
    select net.http_get(
      url := 'https://openlibrary.org/search.json?limit=1&fields=ratings_average,ratings_count&q='
             || public.urlencode(v_query),
      headers := c_ua,
      timeout_milliseconds := 20000
    ) into v_req;
    insert into public.enrich_jobs (book_id, kind, request_id)
    values (b.id, 'ol_ratings', v_req);

    -- Wikipedia: search in the book's language first (it/en), fall back later.
    -- "romanzo"/"novel" in the query biases search toward the BOOK page —
    -- famous adaptations otherwise outrank it (Gone Girl → the Fincher film).
    v_lang := case when b.language = 'it' then 'it' else 'en' end;
    select net.http_get(
      url := 'https://' || v_lang || '.wikipedia.org/w/api.php?action=query&list=search'
             || '&format=json&srlimit=1&srsearch='
             || public.urlencode(b.title || ' ' || coalesce(b.authors[1], '')
                                 || case when v_lang = 'it' then ' romanzo' else ' novel' end),
      headers := c_ua,
      timeout_milliseconds := 20000
    ) into v_req;
    insert into public.enrich_jobs (book_id, kind, lang, request_id)
    values (b.id, 'wiki_search_' || v_lang, v_lang, v_req);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- Ingest: process pg_net responses, chain Wikipedia search → summary,
-- write ratings and excerpts.
-- ---------------------------------------------------------------------
create or replace function public.internal_enrich_ingest()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  j       record;
  v_json  jsonb;
  v_title text;
  v_req   bigint;
  v_other text;
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
          -- Italian miss → one fallback on English Wikipedia.
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
           -- reject adaptation pages (film/TV/miniseries) that outrank the book
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
        end if;
      end if;
    end if;

    delete from public.enrich_jobs where id = j.id;
  end loop;
end;
$$;

select cron.schedule('enrich-enqueue', '3-59/5 * * * *', $$select public.internal_enrich_enqueue()$$);
select cron.schedule('enrich-ingest',  '4-59/5 * * * *', $$select public.internal_enrich_ingest()$$);

-- Circle 1: nightly pre-warm of the most visible books (200/night).
select cron.schedule('enrich-prewarm', '15 3 * * *', $$
  update public.books set enrich_requested_at = now()
  where enrich_requested_at is null
    and id in (
      select id from public.books
      order by (reads_count + saves_count + likes_count + reviews_count) desc, created_at desc
      limit 200
    )
$$);

-- ---------------------------------------------------------------------
-- The recommender gains a quality prior: with a small community the
-- internal popularity counters are near-empty, so external aggregate
-- ratings fill that term until our own data takes over.
-- (pop_aff becomes: greatest(internal popularity, external prior))
-- ---------------------------------------------------------------------
create or replace function public.get_recommendations(
  p_limit  int default 20,
  p_offset int default 0
)
returns setof public.book_reco
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
begin
  return query
  with
  my_books as (
    select ub.book_id, ub.liked, ub.status, ub.rating
    from public.user_books ub
    where ub.user_id = v_user
  ),
  my_positive as (
    select book_id from my_books
    where liked or status = 'read' or coalesce(rating, 0) >= 4
  ),
  my_vec as (
    select avg(b.embedding) as v
    from public.books b
    join my_positive p on p.book_id = b.id
    where b.embedding is not null
  ),
  my_genres as (
    select genre_slug as g from public.user_genre_prefs where user_id = v_user
    union
    select unnest(b.categories) from public.books b
      join my_positive p on p.book_id = b.id
  ),
  my_authors as (
    select distinct unnest(b.authors) as a
    from public.books b join my_positive p on p.book_id = b.id
  ),
  neighbours as (
    select ub.user_id, count(*)::numeric as overlap
    from public.user_books ub
    join my_positive p on p.book_id = ub.book_id
    where ub.user_id <> v_user
      and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
    group by ub.user_id
    order by overlap desc
    limit 50
  ),
  collab as (
    select ub.book_id, sum(n.overlap) as collab_raw
    from public.user_books ub
    join neighbours n on n.user_id = ub.user_id
    where (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
    group by ub.book_id
  ),
  max_collab as (select greatest(max(collab_raw), 1) as m from collab),
  max_pop as (
    select greatest(max(reads_count + saves_count + likes_count), 1)::numeric as m
    from public.books
  ),
  max_ext as (
    select greatest(max((coalesce(external_rating, 0) / 5.0)
                        * ln((1 + coalesce(external_ratings_count, 0))::numeric)), 0.001) as m
    from public.books
  ),
  scored as (
    select
      b.*,
      (
        select count(*)::numeric
        from unnest(b.categories) c
        where c in (select g from my_genres)
      ) / greatest(array_length(b.categories, 1), 1) as genre_aff,
      (exists (
        select 1 from unnest(b.authors) a where a in (select a from my_authors)
      ))::int::numeric as author_aff,
      coalesce((select collab_raw from collab c where c.book_id = b.id), 0)
        / (select m from max_collab) as collab_aff,
      greatest(
        (b.reads_count + b.saves_count + b.likes_count)::numeric / (select m from max_pop),
        ((coalesce(b.external_rating, 0) / 5.0)
          * ln((1 + coalesce(b.external_ratings_count, 0))::numeric)) / (select m from max_ext)
      ) as pop_aff,
      case
        when b.embedding is not null and (select v from my_vec) is not null
        then greatest(0, 1 - (b.embedding <=> (select v from my_vec)))::numeric
        else 0
      end as semantic_aff
    from public.books b
    where b.id not in (select book_id from my_books)
      and b.id not in (select book_id from public.book_dismissals where user_id = v_user)
  )
  select
    s.id, s.title, s.subtitle, s.authors, s.cover_url, s.published_year,
    s.categories,
    case when s.rating_count > 0
         then round(s.rating_sum::numeric / s.rating_count, 2) else null end as avg_rating,
    s.reads_count, s.saves_count, s.likes_count, s.reviews_count,
    round(
      0.30 * s.semantic_aff + 0.25 * s.genre_aff + 0.15 * s.author_aff +
      0.15 * s.collab_aff + 0.15 * s.pop_aff, 4
    ) as score,
    case
      when s.semantic_aff >= 0.55 then 'Vicino ai libri che ami'
      when s.author_aff > 0 then 'Because you read authors you love'
      when s.collab_aff > 0 then 'Popular with readers like you'
      when s.genre_aff > 0 then 'Matches your favourite genres'
      else 'Trending on Tomo'
    end as reason
  from scored s
  order by score desc, (s.reads_count + s.saves_count + s.likes_count) desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

-- =====================================================================
-- 0017_semantic_space
-- Level A of the association model: every book gets an embedding vector
-- (openai/text-embedding-3-small via OpenRouter, truncated to 512 dims —
-- Matryoshka truncation is cosine-safe). pgvector powers "similar books"
-- and a semantic term inside the recommendation blend.
--
-- Incremental pipeline lives fully in Postgres: a pg_cron job batches
-- books that still lack a vector, posts them to OpenRouter through
-- pg_net (key read from Vault — inserted live, never committed), and a
-- second job ingests the async responses. New on-demand imports are
-- therefore embedded within minutes, no external workers.
-- =====================================================================

create extension if not exists vector with schema extensions;
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------
-- Storage: the vector + ANN index for neighbour search.
-- ---------------------------------------------------------------------
alter table public.books
  add column if not exists embedding extensions.vector(512);

create index if not exists books_embedding_hnsw
  on public.books using hnsw (embedding extensions.vector_cosine_ops);

-- In-flight embedding batches (request_id from pg_net).
create table if not exists public.embed_batches (
  request_id bigint primary key,
  book_ids   uuid[] not null,
  created_at timestamptz not null default now()
);
alter table public.embed_batches enable row level security;  -- no policies: service-side only

-- ---------------------------------------------------------------------
-- The text a book is embedded from — one place, so backfill and the
-- cron pipeline can never drift apart.
-- ---------------------------------------------------------------------
create or replace function public.book_embedding_text(b public.books)
returns text
language sql
immutable
as $$
  select left(
    coalesce(b.title, '') || ' — ' ||
    array_to_string(b.authors, ', ') || '. ' ||
    array_to_string(b.categories, ', ') || '. ' ||
    coalesce(b.description, ''),
    1500)
$$;

-- ---------------------------------------------------------------------
-- Enqueue: post one batch of missing-embedding books to OpenRouter.
-- Runs on a cron; skips books already in flight. Popular books first so
-- the visible catalog gets semantic coverage earliest.
-- ---------------------------------------------------------------------
create or replace function public.internal_embed_enqueue()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key   text;
  v_ids   uuid[];
  v_texts jsonb;
  v_req   bigint;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'openrouter_api_key';
  if v_key is null then return; end if;

  -- Drop stale in-flight batches (response TTL exceeded / failed).
  delete from public.embed_batches where created_at < now() - interval '1 hour';

  select array_agg(x.id), jsonb_agg(public.book_embedding_text(x.*))
    into v_ids, v_texts
  from (
    select b.*
    from public.books b
    where b.embedding is null
      and not exists (select 1 from public.embed_batches eb where b.id = any(eb.book_ids))
    order by (b.reads_count + b.saves_count + b.likes_count) desc, b.created_at desc
    limit 64
  ) x;
  if v_ids is null then return; end if;

  select net.http_post(
    url     := 'https://openrouter.ai/api/v1/embeddings',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || v_key,
                 'Content-Type', 'application/json'),
    body    := jsonb_build_object(
                 'model', 'openai/text-embedding-3-small',
                 'input', v_texts,
                 'dimensions', 512),
    timeout_milliseconds := 30000
  ) into v_req;

  insert into public.embed_batches (request_id, book_ids) values (v_req, v_ids);
end;
$$;

-- ---------------------------------------------------------------------
-- Ingest: read pg_net responses, write vectors. Truncates to 512 dims
-- defensively (cosine is scale-invariant, so plain truncation is fine).
-- ---------------------------------------------------------------------
create or replace function public.internal_embed_ingest()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
begin
  for r in
    select eb.request_id, eb.book_ids, resp.status_code, resp.content
    from public.embed_batches eb
    join net._http_response resp on resp.id = eb.request_id
  loop
    if r.status_code = 200 then
      update public.books b
      set embedding = (
        select ('[' || string_agg(e.value::text, ',') || ']')::extensions.vector(512)
        from (
          select value, row_number() over () as rn
          from jsonb_array_elements(d.elem -> 'embedding') as value
        ) e
        where e.rn <= 512
      )
      from (
        select elem, (elem ->> 'index')::int as idx
        from jsonb_array_elements((r.content)::jsonb -> 'data') as elem
      ) d
      where b.id = r.book_ids[d.idx + 1];
    end if;
    delete from public.embed_batches where request_id = r.request_id;
  end loop;
end;
$$;

-- Every 5 minutes: enqueue a batch; ingest whatever came back.
select cron.schedule('embed-enqueue', '*/5 * * * *', $$select public.internal_embed_enqueue()$$);
select cron.schedule('embed-ingest',  '2-59/5 * * * *', $$select public.internal_embed_ingest()$$);

-- ---------------------------------------------------------------------
-- Bulk setter for the one-off backfill (service role only).
-- Rows: [{ "id": "<uuid>", "e": [512 floats] }, ...]
-- ---------------------------------------------------------------------
create or replace function public.set_book_embeddings(p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count int;
begin
  update public.books b
  set embedding = (r.elem -> 'e')::text::extensions.vector(512)
  from (select jsonb_array_elements(p_rows) as elem) r
  where b.id = (r.elem ->> 'id')::uuid;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.set_book_embeddings(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- get_similar_books(): "Simili a questo" — nearest neighbours by cosine.
-- ---------------------------------------------------------------------
create or replace function public.get_similar_books(
  p_book_id uuid,
  p_limit   int default 12
)
returns setof public.book_card
language sql
stable
as $$
  select
    b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
    b.categories, public.book_avg_rating(b) as avg_rating,
    b.reads_count, b.saves_count, b.likes_count, b.reviews_count
  from public.books b
  where b.embedding is not null
    and b.id <> p_book_id
  order by b.embedding <=> (select embedding from public.books where id = p_book_id)
  limit greatest(p_limit, 0)
$$;

grant execute on function public.get_similar_books(uuid, int) to authenticated, anon;

-- ---------------------------------------------------------------------
-- Recommendations v2: add the semantic term.
--
--   score = 0.30 * semantic  (cosine to the user's taste vector —
--                             the average embedding of their positive books)
--         + 0.25 * genre + 0.15 * author + 0.15 * collab + 0.15 * pop
--
-- Users or books without vectors degrade gracefully to the old signals.
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
      (b.reads_count + b.saves_count + b.likes_count)::numeric
        / (select m from max_pop) as pop_aff,
      case
        when b.embedding is not null and (select v from my_vec) is not null
        then greatest(0, 1 - (b.embedding <=> (select v from my_vec)))::numeric
        else 0
      end as semantic_aff
    from public.books b
    where b.id not in (select book_id from my_books)
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

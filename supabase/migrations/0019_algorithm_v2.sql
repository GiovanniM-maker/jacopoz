-- =====================================================================
-- 0019_algorithm_v2
-- The feed learns the same trick the catalog did, and the reco loop
-- gets its measuring instruments:
--   • reviews gain embeddings (same in-database OpenRouter pipeline);
--   • get_community_feed v3: + semantic affinity to the viewer's taste
--     vector and author reputation;
--   • book_dismissals: an explicit "Non mi interessa" that recommenders
--     honour immediately (negative signal);
--   • reco_impressions: what we showed, so CTR/conversion is measurable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Review embeddings.
-- ---------------------------------------------------------------------
alter table public.reviews
  add column if not exists embedding extensions.vector(512);

create index if not exists reviews_embedding_hnsw
  on public.reviews using hnsw (embedding extensions.vector_cosine_ops);

-- The shared embed queue now carries a kind.
alter table public.embed_batches
  add column if not exists kind text not null default 'book'
    check (kind in ('book', 'review'));

-- Canonical embed text for a review: book context + the review itself.
create or replace function public.review_embedding_text(r public.reviews)
returns text
language sql
stable
as $$
  select left(
    coalesce((select b.title || '. ' || array_to_string(b.categories, ', ')
              from public.books b where b.id = r.book_id), '') ||
    '. Recensione: ' || r.body,
    1500)
$$;

create or replace function public.internal_embed_enqueue_reviews()
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

  select array_agg(x.id), jsonb_agg(public.review_embedding_text(x.*))
    into v_ids, v_texts
  from (
    select r.*
    from public.reviews r
    where r.embedding is null
      and r.status = 'visible'
      and not exists (select 1 from public.embed_batches eb
                      where eb.kind = 'review' and r.id = any(eb.book_ids))
    order by r.created_at desc
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

  insert into public.embed_batches (request_id, book_ids, kind)
  values (v_req, v_ids, 'review');
end;
$$;

-- Ingest now writes to books or reviews depending on the batch kind.
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
    select eb.request_id, eb.book_ids, eb.kind, resp.status_code, resp.content
    from public.embed_batches eb
    join net._http_response resp on resp.id = eb.request_id
  loop
    if r.status_code = 200 then
      if r.kind = 'book' then
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
      else
        update public.reviews rv
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
        where rv.id = r.book_ids[d.idx + 1];
      end if;
    end if;
    delete from public.embed_batches where request_id = r.request_id;
  end loop;
end;
$$;

select cron.schedule('embed-enqueue-reviews', '1-59/5 * * * *',
  $$select public.internal_embed_enqueue_reviews()$$);

-- ---------------------------------------------------------------------
-- Negative signal: "Non mi interessa".
-- ---------------------------------------------------------------------
create table if not exists public.book_dismissals (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  book_id    uuid not null references public.books(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, book_id)
);
alter table public.book_dismissals enable row level security;
create policy dismissals_all_own on public.book_dismissals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Impressions: what the recommender actually showed.
-- ---------------------------------------------------------------------
create table if not exists public.reco_impressions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  book_id    uuid not null references public.books(id) on delete cascade,
  surface    text not null default 'home'
               check (surface in ('home', 'similar', 'search')),
  created_at timestamptz not null default now()
);
create index if not exists reco_impressions_user_time
  on public.reco_impressions (user_id, created_at desc);

alter table public.reco_impressions enable row level security;
create policy impressions_insert_own on public.reco_impressions
  for insert with check (user_id = auth.uid());

-- Ops-only metrics: impressions vs "the user then shelved/liked the book".
create or replace view public.reco_metrics as
select
  date_trunc('day', i.created_at) as day,
  i.surface,
  count(*) as impressions,
  count(distinct i.user_id) as users,
  count(*) filter (
    where exists (
      select 1 from public.user_books ub
      where ub.user_id = i.user_id and ub.book_id = i.book_id
        and ub.created_at > i.created_at
    )
  ) as conversions
from public.reco_impressions i
group by 1, 2
order by 1 desc;

revoke all on public.reco_metrics from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Recommendations v3: honour dismissals (hard exclude).
-- Same blend as v2 otherwise.
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

-- ---------------------------------------------------------------------
-- Community feed v3:
--   0.25 engagement + 0.15 quality + 0.15 social/genre affinity
-- + 0.20 semantic (review ↔ viewer taste vector)
-- + 0.10 author reputation + 0.15 freshness      (blocked authors excluded)
-- ---------------------------------------------------------------------
create or replace function public.get_community_feed(
  p_limit  int default 20,
  p_offset int default 0
)
returns setof public.feed_item
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_user uuid := auth.uid();
  c_half_life_hours constant numeric := 48;
begin
  return query
  with
  my_genres as (
    select genre_slug as g from public.user_genre_prefs where user_id = v_user
    union
    select unnest(b.categories)
    from public.user_books ub
    join public.books b on b.id = ub.book_id
    where ub.user_id = v_user and (ub.liked or ub.status = 'read')
  ),
  my_follows as (
    select following_id from public.follows where follower_id = v_user
  ),
  my_blocks as (
    select blocked_id from public.user_blocks where blocker_id = v_user
  ),
  my_vec as (
    select avg(b.embedding) as v
    from public.books b
    join public.user_books ub on ub.book_id = b.id
    where ub.user_id = v_user
      and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
      and b.embedding is not null
  ),
  rep as (
    select r2.user_id, ln((1 + sum(r2.like_count))::numeric) as raw
    from public.reviews r2
    where r2.status = 'visible'
    group by r2.user_id
  ),
  max_rep as (select greatest(max(raw), 1) as m from rep),
  max_eng as (
    select greatest(max(ln(1 + like_count + 1.5 * comment_count)), 1) as m
    from public.reviews where status = 'visible'
  )
  select
    r.id, r.book_id, b.title, b.cover_url, b.authors,
    p.id, p.username, p.display_name, p.avatar_url,
    r.rating, r.body, r.contains_spoilers,
    r.like_count, r.comment_count, r.created_at,
    exists (
      select 1 from public.likes l
      where l.user_id = v_user and l.target_type = 'review' and l.target_id = r.id
    ) as viewer_has_liked,
    round(
        0.25 * (ln(1 + r.like_count + 1.5 * r.comment_count) / (select m from max_eng))
      + 0.15 * r.quality_score
      + 0.15 * (
          case when r.user_id in (select following_id from my_follows) then 1.0
               when exists (select 1 from unnest(b.categories) c
                            where c in (select g from my_genres)) then 0.5
               else 0.0 end)
      + 0.20 * (
          case when r.embedding is not null and (select v from my_vec) is not null
               then greatest(0, 1 - (r.embedding <=> (select v from my_vec)))::numeric
               else 0 end)
      + 0.10 * (coalesce((select raw from rep where rep.user_id = r.user_id), 0)
                  / (select m from max_rep))
      + 0.15 * exp(- (extract(epoch from (now() - r.created_at)) / 3600.0) / c_half_life_hours)
    , 4) as score
  from public.reviews r
  join public.books b on b.id = r.book_id
  join public.profiles p on p.id = r.user_id
  where r.status = 'visible'
    and r.user_id <> v_user
    and r.user_id not in (select blocked_id from my_blocks)
  order by score desc, r.created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

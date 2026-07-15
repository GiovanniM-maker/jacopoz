-- =====================================================================
-- 0006_functions_search_feed_reco
-- The read-side "algorithms": catalog search, trending, the non-ML
-- recommendation engine, and the ranked community feed. All are plain
-- SQL/PLpgSQL RPCs so they are transparent and trivially swappable.
--
-- Weights are grouped as constants at the top of each function and are
-- the only thing you tune. No machine learning, no background jobs.
-- =====================================================================

-- Reusable card shape returned to the app for any "row of books".
create type public.book_card as (
  id             uuid,
  title          text,
  subtitle       text,
  authors        text[],
  cover_url      text,
  published_year smallint,
  categories     text[],
  avg_rating     numeric,
  reads_count    int,
  saves_count    int,
  likes_count    int,
  reviews_count  int
);

-- Recommendation card = book_card + why we surfaced it.
create type public.book_reco as (
  id             uuid,
  title          text,
  subtitle       text,
  authors        text[],
  cover_url      text,
  published_year smallint,
  categories     text[],
  avg_rating     numeric,
  reads_count    int,
  saves_count    int,
  likes_count    int,
  reviews_count  int,
  score          numeric,
  reason         text
);

-- ---------------------------------------------------------------------
-- search_books(): accent-insensitive full-text search with a trigram
-- fallback for typos / short queries. Empty query returns trending.
-- ---------------------------------------------------------------------
create or replace function public.search_books(
  p_query  text default '',
  p_limit  int  default 20,
  p_offset int  default 0
)
returns setof public.book_card
language sql
stable
as $$
  with q as (
    select public.immutable_unaccent(trim(coalesce(p_query, ''))) as term
  )
  select
    b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
    b.categories, public.book_avg_rating(b) as avg_rating,
    b.reads_count, b.saves_count, b.likes_count, b.reviews_count
  from public.books b, q
  where q.term = ''
     or b.search_tsv @@ websearch_to_tsquery('simple', q.term)
     or public.immutable_unaccent(b.title) % q.term
  order by
    case when q.term = '' then 0
         else ts_rank(b.search_tsv, websearch_to_tsquery('simple', q.term))
              + similarity(public.immutable_unaccent(b.title), q.term)
    end desc,
    (b.reads_count + b.saves_count + b.likes_count) desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

-- ---------------------------------------------------------------------
-- get_trending_books(): popularity with a recency tilt. The cold-start
-- backstop for the dashboard when personal signals are thin.
-- ---------------------------------------------------------------------
create or replace function public.get_trending_books(
  p_limit  int default 20,
  p_offset int default 0
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
  order by
    (b.reads_count * 3 + b.saves_count * 2 + b.likes_count * 2 + b.reviews_count)
      * (1.0 + (coalesce(b.published_year, 0) >= extract(year from now())::int - 3)::int * 0.25) desc,
    b.reviews_count desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

-- ---------------------------------------------------------------------
-- get_recommendations(): the non-ML engine.
--
--   score = 0.35 * genre_affinity     (prefs + genres of liked/read books)
--         + 0.25 * author_affinity    (authors of liked/read books)
--         + 0.25 * collaborative      (books liked by taste-neighbours)
--         + 0.15 * popularity         (log-normalized global popularity)
--
-- Books already on the caller's shelf are excluded. New users with no
-- history still get results from explicit genre prefs + popularity, so
-- the dashboard is never empty (cold-start handled).
-- ---------------------------------------------------------------------
create or replace function public.get_recommendations(
  p_limit  int default 20,
  p_offset int default 0
)
returns setof public.book_reco
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  return query
  with
  -- Books the user already interacted with (excluded from output).
  my_books as (
    select ub.book_id, ub.liked, ub.status, ub.rating
    from public.user_books ub
    where ub.user_id = v_user
  ),
  -- Positive signals: liked, rated >= 4, or marked read.
  my_positive as (
    select book_id from my_books
    where liked or status = 'read' or coalesce(rating, 0) >= 4
  ),
  -- Taste vocabulary: explicit genre prefs UNION genres of positive books.
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
  -- Taste-neighbours: other users who share positive books, weighted by
  -- overlap size. Capped for performance.
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
  -- Candidate books surfaced by neighbours (collaborative signal).
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
      -- genre affinity: share of the book's categories that match my taste
      (
        select count(*)::numeric
        from unnest(b.categories) c
        where c in (select g from my_genres)
      ) / greatest(array_length(b.categories, 1), 1) as genre_aff,
      -- author affinity: any shared author -> 1 else 0
      (exists (
        select 1 from unnest(b.authors) a where a in (select a from my_authors)
      ))::int::numeric as author_aff,
      coalesce((select collab_raw from collab c where c.book_id = b.id), 0)
        / (select m from max_collab) as collab_aff,
      (b.reads_count + b.saves_count + b.likes_count)::numeric
        / (select m from max_pop) as pop_aff
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
      0.35 * s.genre_aff + 0.25 * s.author_aff +
      0.25 * s.collab_aff + 0.15 * s.pop_aff, 4
    ) as score,
    case
      when s.author_aff > 0 then 'Because you read authors you love'
      when s.collab_aff > 0 then 'Popular with readers like you'
      when s.genre_aff > 0 then 'Matches your favourite genres'
      else 'Trending on jacopoz'
    end as reason
  from scored s
  order by score desc, (s.reads_count + s.saves_count + s.likes_count) desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

-- ---------------------------------------------------------------------
-- Community feed item shape: the review, its author, its book, plus
-- viewer-specific state and the ranking score.
-- ---------------------------------------------------------------------
create type public.feed_item as (
  review_id         uuid,
  book_id           uuid,
  book_title        text,
  book_cover_url    text,
  book_authors      text[],
  author_id         uuid,
  author_username   text,
  author_display_name text,
  author_avatar_url text,
  rating            smallint,
  body              text,
  contains_spoilers boolean,
  like_count        int,
  comment_count     int,
  created_at        timestamptz,
  viewer_has_liked  boolean,
  score             numeric
);

-- ---------------------------------------------------------------------
-- get_community_feed(): the heart of the product. NOT chronological.
--
--   score = 0.30 * engagement   log(1 + likes + 1.5*comments)  (normalized)
--         + 0.20 * quality      review.quality_score
--         + 0.20 * affinity      follows author (1.0) | shares genre (0.5)
--         + 0.30 * freshness     exp(-age_hours / HALF_LIFE_HOURS)
--
-- Deliberately simple and readable; swap the weights or add a term
-- without touching the app.
-- ---------------------------------------------------------------------
create or replace function public.get_community_feed(
  p_limit  int default 20,
  p_offset int default 0
)
returns setof public.feed_item
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  c_half_life_hours constant numeric := 48;   -- freshness half-life
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
        0.30 * (ln(1 + r.like_count + 1.5 * r.comment_count) / (select m from max_eng))
      + 0.20 * r.quality_score
      + 0.20 * (
          case when r.user_id in (select following_id from my_follows) then 1.0
               when exists (select 1 from unnest(b.categories) c
                            where c in (select g from my_genres)) then 0.5
               else 0.0 end)
      + 0.30 * exp(- (extract(epoch from (now() - r.created_at)) / 3600.0) / c_half_life_hours)
    , 4) as score
  from public.reviews r
  join public.books b on b.id = r.book_id
  join public.profiles p on p.id = r.user_id
  where r.status = 'visible'
    and r.user_id <> v_user
  order by score desc, r.created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

-- Clients call these RPCs; grant execute to signed-in users.
grant execute on function public.search_books(text, int, int) to authenticated, anon;
grant execute on function public.get_trending_books(int, int) to authenticated, anon;
grant execute on function public.get_recommendations(int, int) to authenticated;
grant execute on function public.get_community_feed(int, int) to authenticated;

-- =====================================================================
-- 0021_algorithm_v4_wave1
-- Wave 1 of the competitor-research plan (all pure SQL, zero cost):
--   • feed: conversation-weighted engagement (comment ≈ 15× like, big
--     bonus when the review's author replies back — X's reply weights),
--     and per-author rank decay so prolific reviewers can't own the
--     feed (X's author-diversity heuristic, verbatim formula);
--   • recommendations: 30-day half-life decay on the collaborative
--     signal (social layer decays, items never — Pinterest), greedy MMR
--     re-rank over the top candidates (λ=0.7 — YouTube's anti-duplicate
--     lesson), and reserved exploration slots "Qualcosa di diverso"
--     (TikTok/Spotify's deliberate out-of-taste injection);
--   • impressions gain the shown position (position-bias correction
--     prerequisite).
-- =====================================================================

alter table public.reco_impressions
  add column if not exists position int;

-- ---------------------------------------------------------------------
-- Community feed v4.
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
  -- Conversation-weighted engagement: comments ≈ 15× likes; an author
  -- who replies to commenters ≈ 40× (reciprocated conversation is the
  -- top prize — X weights replies 27× likes, author-engaged replies 150×).
  eng as (
    select r3.id,
           ln((1 + r3.like_count + 15 * r3.comment_count
               + 40 * (select count(*) from public.comments c2
                       where c2.review_id = r3.id
                         and c2.user_id = r3.user_id
                         and c2.parent_comment_id is not null
                         and c2.status = 'visible'))::numeric) as raw
    from public.reviews r3
    where r3.status = 'visible'
  ),
  max_eng as (select greatest(max(raw), 1) as m from eng),
  ranked as (
    select
      r.id as review_id, r.book_id, b.title as book_title,
      b.cover_url as book_cover_url, b.authors as book_authors,
      p.id as author_id, p.username as author_username,
      p.display_name as author_display_name, p.avatar_url as author_avatar_url,
      r.rating, r.body, r.contains_spoilers,
      r.like_count, r.comment_count, r.created_at,
      exists (
        select 1 from public.likes l
        where l.user_id = v_user and l.target_type = 'review' and l.target_id = r.id
      ) as viewer_has_liked,
      (
          0.25 * ((select raw from eng where eng.id = r.id) / (select m from max_eng))
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
      ) as base_score
    from public.reviews r
    join public.books b on b.id = r.book_id
    join public.profiles p on p.id = r.user_id
    where r.status = 'visible'
      and r.user_id <> v_user
      and r.user_id not in (select blocked_id from my_blocks)
  )
  -- Per-author rank decay: the k-th best review by the same author is
  -- worth score × (0.25 + 0.75·0.5^(k-1)) — X's heuristic, verbatim.
  select
    q.review_id, q.book_id, q.book_title, q.book_cover_url, q.book_authors,
    q.author_id, q.author_username, q.author_display_name, q.author_avatar_url,
    q.rating, q.body, q.contains_spoilers,
    q.like_count, q.comment_count, q.created_at,
    q.viewer_has_liked,
    round(q.base_score
          * (0.25 + 0.75 * power(0.5,
              (row_number() over (partition by q.author_id order by q.base_score desc))::numeric - 1)),
          4) as score
  from ranked q
  order by score desc, q.created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

-- Same conversation weighting on the book page's ranked reviews.
create or replace function public.get_book_reviews_ranked(
  p_book_id uuid,
  p_limit   int default 30,
  p_offset  int default 0
)
returns setof public.feed_item
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  c_half_life_hours constant numeric := 72;
begin
  return query
  with
  my_genres as (
    select genre_slug as g from public.user_genre_prefs where user_id = v_user
    union
    select unnest(b.categories)
    from public.user_books ub join public.books b on b.id = ub.book_id
    where ub.user_id = v_user and (ub.liked or ub.status = 'read')
  ),
  my_follows as (
    select following_id from public.follows where follower_id = v_user
  ),
  max_eng as (
    select greatest(max(ln((1 + like_count + 15 * comment_count)::numeric)), 1) as m
    from public.reviews where book_id = p_book_id and status = 'visible'
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
        0.35 * (
          case when r.user_id in (select following_id from my_follows) then 1.0
               when exists (select 1 from public.user_books ub
                            join public.books rb on rb.id = ub.book_id
                            where ub.user_id = r.user_id and (ub.liked or ub.status = 'read')
                              and rb.categories && (select array_agg(g) from my_genres)) then 0.5
               else 0.0 end)
      + 0.25 * r.quality_score
      + 0.25 * (ln((1 + r.like_count + 15 * r.comment_count)::numeric) / (select m from max_eng))
      + 0.15 * exp(- (extract(epoch from (now() - r.created_at)) / 3600.0) / c_half_life_hours)
    , 4) as score
  from public.reviews r
  join public.books b on b.id = r.book_id
  join public.profiles p on p.id = r.user_id
  where r.book_id = p_book_id
    and r.status = 'visible'
    and r.user_id not in (select blocked_id from public.user_blocks where blocker_id = v_user)
  order by score desc, r.created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

-- ---------------------------------------------------------------------
-- Recommendations v5: collab recency decay + greedy MMR + exploration.
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
  v_user    uuid := auth.uid();
  v_taste   extensions.vector(512);
  v_ids     uuid[];
  v_scores  numeric[];
  v_reasons text[];
  v_embs    extensions.vector(512)[];
  v_n       int;
  v_take    int;
  v_explore int;
  v_sel     int[] := '{}';
  v_best    int;
  v_bestval numeric;
  v_val     numeric;
  v_maxsim  numeric;
  i         int;
  j         int;
begin
  -- Taste vector (average embedding of positive books).
  select avg(b.embedding) into v_taste
  from public.books b
  join public.user_books ub on ub.book_id = b.id
  where ub.user_id = v_user
    and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
    and b.embedding is not null;

  -- Score the catalog (same blend as v3/v4) and keep the top 60.
  with
  my_books as (
    select ub.book_id, ub.liked, ub.status, ub.rating
    from public.user_books ub where ub.user_id = v_user
  ),
  my_positive as (
    select book_id from my_books
    where liked or status = 'read' or coalesce(rating, 0) >= 4
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
  -- Social layer decays (30-day half-life); the item layer never does.
  collab as (
    select ub.book_id,
           sum(n.overlap
               * exp(- ln(2::numeric) / 30.0
                     * extract(epoch from (now() - coalesce(ub.updated_at, ub.created_at)))
                       / 86400.0)) as collab_raw
    from public.user_books ub
    join neighbours n on n.user_id = ub.user_id
    where (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
    group by ub.book_id
  ),
  max_collab as (select greatest(max(collab_raw), 0.001) as m from collab),
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
      b.id, b.embedding,
      (
        select count(*)::numeric from unnest(b.categories) c
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
        when b.embedding is not null and v_taste is not null
        then greatest(0, 1 - (b.embedding <=> v_taste))::numeric
        else 0
      end as semantic_aff
    from public.books b
    where b.id not in (select book_id from my_books)
      and b.id not in (select book_id from public.book_dismissals where user_id = v_user)
  ),
  top60 as (
    select
      s.id, s.embedding,
      round(0.30 * s.semantic_aff + 0.25 * s.genre_aff + 0.15 * s.author_aff +
            0.15 * s.collab_aff + 0.15 * s.pop_aff, 4) as score,
      case
        when s.semantic_aff >= 0.55 then 'Vicino ai libri che ami'
        when s.author_aff > 0 then 'Because you read authors you love'
        when s.collab_aff > 0 then 'Popular with readers like you'
        when s.genre_aff > 0 then 'Matches your favourite genres'
        else 'Trending on Tomo'
      end as reason
    from scored s
    order by score desc
    limit 60
  )
  select array_agg(t.id), array_agg(t.score), array_agg(t.reason), array_agg(t.embedding)
  into v_ids, v_scores, v_reasons, v_embs
  from top60 t;

  if v_ids is null then return; end if;
  v_n := array_length(v_ids, 1);

  -- Reserve ~1 in 10 slots for out-of-taste exploration.
  v_explore := case when v_taste is not null and p_limit >= 10
                    then greatest(1, p_limit / 10) else 0 end;
  v_take := least(greatest(p_limit, 0) + greatest(p_offset, 0) - v_explore, v_n);

  -- Greedy MMR (λ = 0.7): relevance minus max similarity to already picked.
  for step in 1..v_take loop
    v_best := null; v_bestval := null;
    for i in 1..v_n loop
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

  -- Emit the MMR slate (respecting offset).
  return query
  select
    b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
    b.categories,
    case when b.rating_count > 0
         then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
    b.reads_count, b.saves_count, b.likes_count, b.reviews_count,
    v_scores[s.idx], v_reasons[s.idx]
  from unnest(v_sel[(greatest(p_offset, 0) + 1):v_take]) with ordinality as s(idx, ord)
  join public.books b on b.id = v_ids[s.idx]
  order by s.ord;

  -- Exploration picks: good books far from your taste, rotated daily.
  if v_explore > 0 then
    return query
    select
      b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
      b.categories,
      case when b.rating_count > 0
           then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
      b.reads_count, b.saves_count, b.likes_count, b.reviews_count,
      0.05::numeric, 'Qualcosa di diverso'::text
    from public.books b
    where b.embedding is not null
      and greatest(0, 1 - (b.embedding <=> v_taste)) < 0.35
      and b.id not in (select ub.book_id from public.user_books ub where ub.user_id = v_user)
      and b.id not in (select bd.book_id from public.book_dismissals bd where bd.user_id = v_user)
    order by
      (coalesce(b.external_rating, 3) / 5.0)
        * ('x' || substr(md5(b.id::text || current_date::text), 1, 8))::bit(32)::bigint::numeric desc
    limit v_explore;
  end if;
end;
$$;

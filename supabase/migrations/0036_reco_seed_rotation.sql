-- =====================================================================
-- 0036 — living recommendations: seeded rotation + real pagination
--
-- Problem: get_recommendations was fully deterministic. It scored the catalog,
-- kept the top 60, ran MMR, and sliced with p_offset *inside those 60*. So:
--   • every visit produced the identical slate (the app felt static, "no
--     algorithm behind it"),
--   • infinite scroll was impossible (nothing existed past 60),
--   • a pull-to-refresh had nothing new to show.
--
-- Fix: widen the candidate pool and add a caller-supplied p_seed that applies a
-- deterministic per-(book,seed) jitter to the score. Same seed → same slate
-- (stable while paging); new seed → a genuinely different, still-relevant mix.
-- The MMR window is now bounded to the requested page, so page 1 is *cheaper*
-- than before despite the bigger pool.
-- =====================================================================

drop function if exists public.get_recommendations(int, int);

create or replace function public.get_recommendations(
  p_limit  int default 20,
  p_offset int default 0,
  p_seed   int default 0
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
  v_cap     int;
  v_explore int;
  v_sel     int[] := '{}';
  v_best    int;
  v_bestval numeric;
  v_val     numeric;
  v_maxsim  numeric;
  i         int;
  j         int;
begin
  select avg(b.embedding) into v_taste
  from public.books b
  join public.user_books ub on ub.book_id = b.id
  where ub.user_id = v_user
    and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
    and b.embedding is not null;

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
  collab as (
    select ub.book_id, sum(n.overlap) as collab_raw
    from public.user_books ub
    join neighbours n on n.user_id = ub.user_id
    where (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
    group by ub.book_id
  ),
  max_collab as (select greatest(coalesce(max(collab_raw), 1), 1) as m from collab),
  max_pop as (
    select greatest(coalesce(max(reads_count + saves_count + likes_count), 1), 1)::numeric as m
    from public.books
  ),
  max_ext as (
    select greatest(coalesce(max((coalesce(external_rating,0)/5.0)
      * ln((1 + coalesce(external_ratings_count,0))::numeric)), 1), 1) as m
    from public.books
  ),
  scored as (
    select
      b.id, b.embedding, b.created_at,
      (select count(*) from unnest(b.categories) c where c in (select g from my_genres))::numeric
        / greatest(coalesce(array_length(b.categories, 1), 1), 1) as genre_aff,
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
  -- Wider pool than before (200 vs 60) so deep scroll has somewhere to go and
  -- rotation has real material to draw from.
  pool as (
    select
      s.id, s.embedding,
      round(0.30 * s.semantic_aff + 0.25 * s.genre_aff + 0.15 * s.author_aff +
            0.15 * s.collab_aff + 0.15 * s.pop_aff, 4) as score,
      case
        when s.semantic_aff >= 0.55 then 'Vicino ai libri che ami'
        when s.author_aff > 0 then 'Dagli autori che ami'
        when s.collab_aff > 0 then 'Popolare tra lettori come te'
        when s.genre_aff > 0 then 'Nei tuoi generi preferiti'
        else 'Di tendenza su Tomo'
      end as reason
    from scored s
    order by score desc
    limit 200
  ),
  -- Seeded jitter: deterministic for a given (book, seed) so paging is stable,
  -- but a new seed reshuffles which good books surface. Capped at 0.12 so a
  -- weak match can never outrank a strong one — it reorders peers, not tiers.
  jittered as (
    select
      p.id, p.embedding, p.reason,
      p.score + (abs(hashtext(p.id::text || ':' || p_seed::text)) % 1000)::numeric / 1000 * 0.12
        as score
    from pool p
  )
  select array_agg(t.id order by t.score desc),
         array_agg(t.score order by t.score desc),
         array_agg(t.reason order by t.score desc),
         array_agg(t.embedding order by t.score desc)
  into v_ids, v_scores, v_reasons, v_embs
  from jittered t;

  if v_ids is null then return; end if;
  v_n := array_length(v_ids, 1);

  v_explore := case when v_taste is not null and p_limit >= 10
                    then greatest(1, p_limit / 10) else 0 end;
  v_take := least(greatest(p_limit, 0) + greatest(p_offset, 0) - v_explore, v_n);
  -- Bound the O(n²) MMR to what this page actually needs (+ a small lookahead).
  v_cap := least(v_n, v_take + 10);

  for step in 1..v_take loop
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

  -- Exploration slots: good books far from your taste. Rotated by the seed too,
  -- so "something different" is actually different each refresh.
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
        * (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000)::numeric / 1000 desc
    limit v_explore;
  end if;
end;
$$;

grant execute on function public.get_recommendations(int, int, int) to authenticated, anon;

-- Trending: keep the ranking honest but rotate within the strong candidates so
-- "Top 10 / di tendenza" isn't frozen for days.
create or replace function public.get_trending_seeded(
  p_limit int default 20,
  p_seed  int default 0
)
returns setof public.book_card
language sql
stable
security definer
set search_path = public, extensions
as $$
  with pool as (
    select b.*, (b.reads_count + b.saves_count + b.likes_count + b.reviews_count) as pop
    from public.books b
    where b.cover_url is not null
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
$$;
grant execute on function public.get_trending_seeded(int, int) to authenticated, anon;

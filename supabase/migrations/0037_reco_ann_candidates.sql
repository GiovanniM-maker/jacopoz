-- =====================================================================
-- 0037 — make recommendations fast (use the ANN index) and paginate cleanly
--
-- Two defects found while testing 0036:
--
--  1. PERFORMANCE (pre-existing, severe): the function scored the *entire*
--     catalogue (67k rows) to keep the top N, computing a cosine per row. The
--     HNSW index was never used, so this was a sequential scan: 9–23 s.
--     Measured: the same ANN query with the taste vector as a parameter uses
--     books_embedding_hnsw and runs in ~3 ms warm / ~900 ms cold.
--     Fix: retrieve a bounded candidate set through the index first, then score
--     only those few hundred rows.
--
--  2. PAGINATION OVERLAP: the MMR slate was rebuilt with a different window per
--     page, so page 2 repeated books from page 1. Fix: build one deterministic
--     slate per (user, seed) and slice it — pages are now disjoint.
-- =====================================================================

drop function if exists public.get_recommendations(int, int, int);

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
  v_cand    uuid[] := '{}';
  v_ids     uuid[];
  v_scores  numeric[];
  v_reasons text[];
  v_embs    extensions.vector(512)[];
  v_n       int;
  v_slate   int := 72;   -- deterministic slate size; pages slice into this
  v_cap     int;
  v_explore int;
  v_sel     int[] := '{}';
  v_best    int;
  v_bestval numeric;
  v_val     numeric;
  v_maxsim  numeric;
  i         int;
  j         int;
  step      int;
begin
  -- NB: no SET LOCAL here — Postgres forbids SET in a non-volatile function,
  -- and this one is STABLE. The default hnsw.ef_search gives ample recall for a
  -- 400-row candidate probe.

  select avg(b.embedding) into v_taste
  from public.books b
  join public.user_books ub on ub.book_id = b.id
  where ub.user_id = v_user
    and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
    and b.embedding is not null;

  -- Bounded candidate set. v_taste is a PL/pgSQL variable, so the ORDER BY is
  -- index-scannable (this is what turns a 67k seq scan into an index probe).
  -- The vector must be inlined as a literal: with a plain PL/pgSQL variable the
  -- cached generic plan ignores books_embedding_hnsw and falls back to a
  -- sequential scan. Measured on this catalogue: parameter 1010 ms vs
  -- literal 6 ms for the identical top-400 probe.
  if v_taste is not null then
    execute format(
      'select array_agg(s.id) from ('
      || 'select b.id from public.books b where b.embedding is not null '
      || 'order by b.embedding <=> %L::extensions.vector limit 400) s',
      v_taste::text
    ) into v_cand;
  end if;

  -- Always mix in strong popular/well-rated books so the non-semantic signals
  -- (genre, author, collaborative, popularity) have material to rank, and so a
  -- brand-new user with no taste vector still gets a full slate.
  select coalesce(v_cand, '{}') || coalesce(array_agg(s.id), '{}') into v_cand
  from (
    select b.id from public.books b
    where b.cover_url is not null
    order by (b.reads_count + b.saves_count + b.likes_count + b.reviews_count) desc,
             coalesce(b.external_rating, 0) desc
    limit 300
  ) s;

  if v_cand is null or array_length(v_cand, 1) is null then return; end if;

  with
  cand as materialized (select distinct unnest(v_cand) as id),
  my_books as materialized (
    select ub.book_id, ub.liked, ub.status, ub.rating
    from public.user_books ub where ub.user_id = v_user
  ),
  my_positive as materialized (
    select book_id from my_books
    where liked or status = 'read' or coalesce(rating, 0) >= 4
  ),
  my_genres as materialized (
    select genre_slug as g from public.user_genre_prefs where user_id = v_user
    union
    select unnest(b.categories) from public.books b
      join my_positive p on p.book_id = b.id
  ),
  my_authors as materialized (
    select distinct unnest(b.authors) as a
    from public.books b join my_positive p on p.book_id = b.id
  ),
  neighbours as materialized (
    select ub.user_id, count(*)::numeric as overlap
    from public.user_books ub
    join my_positive p on p.book_id = ub.book_id
    where ub.user_id <> v_user
      and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
    group by ub.user_id
    order by overlap desc
    limit 50
  ),
  collab as materialized (
    select ub.book_id, sum(n.overlap) as collab_raw
    from public.user_books ub
    join neighbours n on n.user_id = ub.user_id
    where (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
    group by ub.book_id
  ),
  max_collab as (select greatest(coalesce(max(collab_raw), 1), 1) as m from collab),
  max_pop as (
    select greatest(coalesce(max(b.reads_count + b.saves_count + b.likes_count), 1), 1)::numeric as m
    from public.books b join cand c on c.id = b.id
  ),
  max_ext as (
    select greatest(coalesce(max((coalesce(b.external_rating,0)/5.0)
      * ln((1 + coalesce(b.external_ratings_count,0))::numeric)), 1), 1) as m
    from public.books b join cand c on c.id = b.id
  ),
  scored as (
    select
      b.id, b.embedding,
      (select count(*) from unnest(b.categories) cc where cc in (select g from my_genres))::numeric
        / greatest(coalesce(array_length(b.categories, 1), 1), 1) as genre_aff,
      (exists (
        select 1 from unnest(b.authors) a where a in (select a from my_authors)
      ))::int::numeric as author_aff,
      coalesce((select collab_raw from collab c2 where c2.book_id = b.id), 0)
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
    join cand c on c.id = b.id
    where b.id not in (select book_id from my_books)
      and b.id not in (select book_id from public.book_dismissals where user_id = v_user)
  ),
  ranked as (
    select
      s.id, s.embedding,
      round(0.30 * s.semantic_aff + 0.25 * s.genre_aff + 0.15 * s.author_aff +
            0.15 * s.collab_aff + 0.15 * s.pop_aff, 4)
      -- Seeded jitter (deterministic per book+seed, capped so it reorders
      -- peers rather than promoting weak matches over strong ones).
      + (abs(hashtext(s.id::text || ':' || p_seed::text)) % 1000)::numeric / 1000 * 0.12
        as score,
      case
        when s.semantic_aff >= 0.55 then 'Vicino ai libri che ami'
        when s.author_aff > 0 then 'Dagli autori che ami'
        when s.collab_aff > 0 then 'Popolare tra lettori come te'
        when s.genre_aff > 0 then 'Nei tuoi generi preferiti'
        else 'Di tendenza su Tomo'
      end as reason
    from scored s
  )
  select array_agg(t.id order by t.score desc),
         array_agg(t.score order by t.score desc),
         array_agg(t.reason order by t.score desc),
         array_agg(t.embedding order by t.score desc)
  into v_ids, v_scores, v_reasons, v_embs
  from (select * from ranked order by score desc limit 200) t;

  if v_ids is null then return; end if;
  v_n := array_length(v_ids, 1);

  -- One deterministic MMR slate per (user, seed) — independent of p_offset, so
  -- consecutive pages are disjoint instead of re-deriving a shifted order.
  v_slate := least(v_slate, v_n);
  v_cap := least(v_n, v_slate + 20);

  for step in 1..v_slate loop
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

  -- Exploration slots only on the first page, so they don't repeat while
  -- scrolling. Rotated by the seed.
  v_explore := case when v_taste is not null and p_limit >= 10 and greatest(p_offset, 0) = 0
                    then greatest(1, p_limit / 10) else 0 end;

  return query
  select
    b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
    b.categories,
    case when b.rating_count > 0
         then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
    b.reads_count, b.saves_count, b.likes_count, b.reviews_count,
    v_scores[s.idx], v_reasons[s.idx]
  from unnest(
         v_sel[(greatest(p_offset, 0) + 1):(greatest(p_offset, 0) + greatest(p_limit, 0) - v_explore)]
       ) with ordinality as s(idx, ord)
  join public.books b on b.id = v_ids[s.idx]
  order by s.ord;

  if v_explore > 0 then
    return query
    select
      b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
      b.categories,
      case when b.rating_count > 0
           then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
      b.reads_count, b.saves_count, b.likes_count, b.reviews_count,
      0.05::numeric, 'Qualcosa di diverso'::text
    -- Reuse the candidate set already in memory. Scanning the whole catalogue
    -- here was the single biggest cost in this function (a full 67k-row cosine
    -- scan with no usable index, seconds per call).
    from public.books b
    join (select distinct unnest(v_cand) as id) c on c.id = b.id
    where b.embedding is not null
      and b.cover_url is not null
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

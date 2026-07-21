-- =====================================================================
-- 0022_algorithm_wave2
-- Wave 2 of the competitor-research plan:
--   • signal hierarchy — interactions weighted by depth (finished+5★=8
--     … click-level=1), the YouTube "weight positives by depth" lesson;
--   • multi-cluster taste profiles with medoids (Spotify/PinnerSage):
--     a reader of hard sci-fi AND cozy romance gets separate clusters,
--     each represented by an actual beloved book — which also powers
--     the honest explanation "Perché hai amato «X»";
--   • shelf/list co-occurrence with differential-probability lift
--     (Amazon 2003's anti-bestseller correction) as a second
--     collaborative signal.
-- All in-database, nightly cron jobs, zero external cost.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Signal hierarchy: how much an interaction says about taste.
-- ---------------------------------------------------------------------
create or replace function public.interaction_weight(ub public.user_books)
returns numeric
language sql
immutable
as $$
  select case
    when ub.status = 'read' and coalesce(ub.rating, 0) >= 5 then 8
    when ub.status = 'read' and coalesce(ub.rating, 0) >= 4 then 7
    when ub.status = 'read'                                 then 6
    when ub.status = 'reading'                              then 5
    when ub.liked                                           then 4
    when ub.status = 'want_to_read'                         then 2
    else 1
  end::numeric
$$;

-- ---------------------------------------------------------------------
-- Multi-cluster taste profiles.
-- ---------------------------------------------------------------------
create table if not exists public.user_taste_clusters (
  user_id        uuid not null references public.profiles(id) on delete cascade,
  cluster_idx    int  not null,
  centroid       extensions.vector(512) not null,
  medoid_book_id uuid references public.books(id) on delete set null,
  weight         numeric not null default 1,
  updated_at     timestamptz not null default now(),
  primary key (user_id, cluster_idx)
);
alter table public.user_taste_clusters enable row level security;  -- server-side only

-- Nightly k-means (few iterations are plenty at this scale) over each
-- user's positively-signalled embedded books, weighted by interaction
-- depth. k grows with library size, capped at 4.
create or replace function public.internal_build_taste_clusters()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  u record;
  v_embs   extensions.vector(512)[];
  v_ids    uuid[];
  v_w      numeric[];
  v_n      int;
  v_k      int;
  v_assign int[];
  v_cents  extensions.vector(512)[];
  v_tmp    extensions.vector(512);
  v_best   int;
  v_bestd  numeric;
  v_d      numeric;
  i int; c int; iter int;
begin
  for u in select distinct ub.user_id from public.user_books ub loop
    select array_agg(b.embedding), array_agg(b.id), array_agg(public.interaction_weight(ub.*))
      into v_embs, v_ids, v_w
    from public.user_books ub
    join public.books b on b.id = ub.book_id
    where ub.user_id = u.user_id
      and (ub.liked or ub.status in ('read', 'reading') or coalesce(ub.rating, 0) >= 4)
      and b.embedding is not null;

    delete from public.user_taste_clusters where user_id = u.user_id;
    if v_embs is null then continue; end if;
    v_n := array_length(v_embs, 1);
    v_k := least(4, greatest(1, floor(sqrt(v_n / 2.0))::int));

    -- init centroids: spread over the highest-weight books
    v_cents := '{}';
    for c in 1..v_k loop
      v_cents := v_cents || v_embs[1 + ((c - 1) * v_n / v_k)];
    end loop;

    -- Lloyd iterations
    for iter in 1..8 loop
      v_assign := '{}';
      for i in 1..v_n loop
        v_best := 1; v_bestd := null;
        for c in 1..v_k loop
          v_d := v_embs[i] <=> v_cents[c];
          if v_bestd is null or v_d < v_bestd then v_bestd := v_d; v_best := c; end if;
        end loop;
        v_assign := v_assign || v_best;
      end loop;
      -- recompute weighted centroids (weight by replicating in avg via sum trick)
      for c in 1..v_k loop
        select avg(e) into v_tmp
        from (
          select v_embs[i2] as e
          from generate_subscripts(v_embs, 1) i2
          join lateral generate_series(1, greatest(1, round(v_w[i2])::int)) g on true
          where v_assign[i2] = c
        ) s;
        v_cents[c] := coalesce(v_tmp, v_embs[1 + (c - 1) % v_n]);
      end loop;
    end loop;

    -- persist: centroid + medoid (closest member) + weight (share of signal)
    for c in 1..v_k loop
      insert into public.user_taste_clusters
        (user_id, cluster_idx, centroid, medoid_book_id, weight, updated_at)
      select
        u.user_id, c, v_cents[c],
        (select v_ids[i3] from generate_subscripts(v_ids, 1) i3
         where v_assign[i3] = c
         order by v_embs[i3] <=> v_cents[c] limit 1),
        coalesce((select sum(v_w[i4]) from generate_subscripts(v_w, 1) i4
                  where v_assign[i4] = c), 0),
        now()
      where exists (select 1 from generate_subscripts(v_ids, 1) i5 where v_assign[i5] = c);
    end loop;
  end loop;
end;
$$;

select cron.schedule('taste-clusters', '40 2 * * *',
  $$select public.internal_build_taste_clusters()$$);

-- ---------------------------------------------------------------------
-- Shelf/list co-occurrence with differential-probability lift.
-- lift(A→B) = P(B | user positive on A) / P(B)  — bestsellers stop
-- dominating because their base rate P(B) divides them down.
-- ---------------------------------------------------------------------
create table if not exists public.book_cooccurrence (
  book_a uuid not null references public.books(id) on delete cascade,
  book_b uuid not null references public.books(id) on delete cascade,
  lift   numeric not null,
  pairs  int not null,
  primary key (book_a, book_b)
);
alter table public.book_cooccurrence enable row level security;  -- server-side only

create or replace function public.internal_build_cooccurrence()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate public.book_cooccurrence;
  insert into public.book_cooccurrence (book_a, book_b, lift, pairs)
  with pos as (
    select ub.user_id, ub.book_id
    from public.user_books ub
    where ub.liked or ub.status in ('read', 'reading') or coalesce(ub.rating, 0) >= 4
    union
    select bl.user_id, bli.book_id
    from public.book_lists bl
    join public.book_list_items bli on bli.list_id = bl.id
  ),
  n_users as (select greatest(count(distinct user_id), 1)::numeric as n from pos),
  item_users as (
    select book_id, count(distinct user_id)::numeric as cnt from pos group by book_id
  ),
  pair_counts as (
    select a.book_id as book_a, b.book_id as book_b,
           count(distinct a.user_id)::int as pairs
    from pos a
    join pos b on b.user_id = a.user_id and b.book_id <> a.book_id
    group by a.book_id, b.book_id
    having count(distinct a.user_id) >= 2
  ),
  ranked as (
    select
      pc.book_a, pc.book_b, pc.pairs,
      (pc.pairs / ia.cnt) / (ib.cnt / (select n from n_users)) as lift,
      row_number() over (partition by pc.book_a order by
        (pc.pairs / ia.cnt) / (ib.cnt / (select n from n_users)) desc) as rn
    from pair_counts pc
    join item_users ia on ia.book_id = pc.book_a
    join item_users ib on ib.book_id = pc.book_b
  )
  select book_a, book_b, round(lift, 4), pairs
  from ranked where rn <= 30;
end;
$$;

select cron.schedule('book-cooccurrence', '50 2 * * *',
  $$select public.internal_build_cooccurrence()$$);

-- ---------------------------------------------------------------------
-- Recommendations v6: cluster-based semantic affinity with medoid
-- explanations, depth-weighted collab, co-occurrence folded in.
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
  -- Fallback taste vector (users not yet clustered).
  select avg(b.embedding) into v_taste
  from public.books b
  join public.user_books ub on ub.book_id = b.id
  where ub.user_id = v_user
    and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
    and b.embedding is not null;

  with
  my_books as (
    select ub.book_id from public.user_books ub where ub.user_id = v_user
  ),
  my_positive as (
    select ub.book_id, public.interaction_weight(ub.*) as w
    from public.user_books ub
    where ub.user_id = v_user
      and (ub.liked or ub.status in ('read', 'reading') or coalesce(ub.rating, 0) >= 4)
  ),
  my_clusters as (
    select c.centroid, c.weight, b.title as medoid_title
    from public.user_taste_clusters c
    left join public.books b on b.id = c.medoid_book_id
    where c.user_id = v_user
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
    select ub.user_id, sum(p.w * public.interaction_weight(ub.*)) / 64.0 as overlap
    from public.user_books ub
    join my_positive p on p.book_id = ub.book_id
    where ub.user_id <> v_user
      and (ub.liked or ub.status in ('read', 'reading') or coalesce(ub.rating, 0) >= 4)
    group by ub.user_id
    order by overlap desc
    limit 50
  ),
  collab as (
    select ub.book_id,
           sum(n.overlap * (public.interaction_weight(ub.*) / 8.0)
               * exp(- ln(2::numeric) / 30.0
                     * extract(epoch from (now() - coalesce(ub.updated_at, ub.created_at)))
                       / 86400.0)) as collab_raw
    from public.user_books ub
    join neighbours n on n.user_id = ub.user_id
    where (ub.liked or ub.status in ('read', 'reading') or coalesce(ub.rating, 0) >= 4)
    group by ub.book_id
  ),
  cooc as (
    select bc.book_b as book_id, max(bc.lift) as lift
    from public.book_cooccurrence bc
    join my_positive p on p.book_id = bc.book_a
    group by bc.book_b
  ),
  max_cooc as (select greatest(max(lift), 0.001) as m from cooc),
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
      greatest(
        coalesce((select collab_raw from collab c where c.book_id = b.id), 0)
          / (select m from max_collab),
        coalesce((select lift from cooc c2 where c2.book_id = b.id), 0)
          / (select m from max_cooc)
      ) as collab_aff,
      greatest(
        (b.reads_count + b.saves_count + b.likes_count)::numeric / (select m from max_pop),
        ((coalesce(b.external_rating, 0) / 5.0)
          * ln((1 + coalesce(b.external_ratings_count, 0))::numeric)) / (select m from max_ext)
      ) as pop_aff,
      coalesce(cl.aff, case
        when b.embedding is not null and v_taste is not null
        then greatest(0, 1 - (b.embedding <=> v_taste))::numeric
        else 0 end) as semantic_aff,
      cl.medoid_title
    from public.books b
    left join lateral (
      select greatest(0, 1 - min(b.embedding <=> mc.centroid))::numeric as aff,
             (array_agg(mc.medoid_title order by (b.embedding <=> mc.centroid)))[1] as medoid_title
      from my_clusters mc
      where b.embedding is not null
    ) cl on true
    where b.id not in (select book_id from my_books)
      and b.id not in (select book_id from public.book_dismissals where user_id = v_user)
  ),
  top60 as (
    select
      s.id, s.embedding,
      round(0.30 * s.semantic_aff + 0.25 * s.genre_aff + 0.15 * s.author_aff +
            0.15 * s.collab_aff + 0.15 * s.pop_aff, 4) as score,
      case
        -- 'SEM' is a marker: the final select names the nearest beloved
        -- book (computed only for the emitted slate — cheap and precise).
        when s.semantic_aff >= 0.55 then 'SEM'
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

  v_explore := case when v_taste is not null and p_limit >= 10
                    then greatest(1, p_limit / 10) else 0 end;
  v_take := least(greatest(p_limit, 0) + greatest(p_offset, 0) - v_explore, v_n);

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

  return query
  select
    b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
    b.categories,
    case when b.rating_count > 0
         then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
    b.reads_count, b.saves_count, b.likes_count, b.reviews_count,
    v_scores[s.idx],
    case
      when v_reasons[s.idx] = 'SEM' and np.title is not null
        then 'Perché hai amato «' || np.title || '»'
      when v_reasons[s.idx] = 'SEM' then 'Vicino ai libri che ami'
      else v_reasons[s.idx]
    end
  from unnest(v_sel[(greatest(p_offset, 0) + 1):v_take]) with ordinality as s(idx, ord)
  join public.books b on b.id = v_ids[s.idx]
  left join lateral (
    select pb.title
    from public.user_books ub2
    join public.books pb on pb.id = ub2.book_id
    where ub2.user_id = v_user
      and (ub2.liked or ub2.status in ('read', 'reading') or coalesce(ub2.rating, 0) >= 4)
      and pb.embedding is not null and b.embedding is not null
    order by pb.embedding <=> b.embedding
    limit 1
  ) np on true
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

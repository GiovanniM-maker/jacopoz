-- =====================================================================
-- 0047 — halve the ANN index so it fits in shared_buffers
--
-- The recommendation carousel measured 260 ms warm but 830–1 660 ms cold, and
-- the cause is memory, not query shape:
--
--   shared_buffers        224 MB   (28 672 × 8 kB, free-tier instance)
--   books_embedding_hnsw  176 MB
--   books (heap)           51 MB
--
-- The index alone nearly fills the buffer pool, so it and the table evict each
-- other and every idle period lands the next reader on disk.
--
-- pgvector's halfvec stores each component as a 16-bit float instead of 32-bit,
-- so the same HNSW graph over 512 dimensions costs about half as much. Recall
-- is effectively unchanged — the embeddings are normalised and cosine ranking
-- is nowhere near sensitive to the 11-bit mantissa.
--
-- The `embedding` column stays vector(512): only the index and the ORDER BY
-- expressions are cast. Every non-indexed use (scalar affinity, MMR pairwise
-- distances) keeps full precision.
-- =====================================================================

-- The build needs room, otherwise it spills to disk and takes minutes. A
-- parallel build allocates its graph in a shared memory segment, which this
-- instance cannot size (it fails outright at 192 MB), so build single-threaded
-- in local memory instead — 96 MB comfortably holds the ~88 MB graph.
set max_parallel_maintenance_workers = 0;
set maintenance_work_mem = '96MB';

create index if not exists books_embedding_halfvec_hnsw
  on public.books
  using hnsw ((embedding::extensions.halfvec(512)) extensions.halfvec_cosine_ops);

-- NOTE ON RUNNING THIS: the build takes roughly four minutes on this instance
-- and the Management API caps a statement at two minutes, so it was executed
-- through a one-shot pg_cron job (`set local statement_timeout = 0`) rather
-- than inline. A `supabase db push` against a normal connection has no such cap
-- and can run it as written.

-- ---------------------------------------------------------------------
-- Point the three index-using ANN probes at the halfvec index. Everything
-- else keeps full precision: the MMR pairwise distances and the scalar taste
-- affinity run over a few dozen rows already in memory, where the narrower
-- type buys nothing.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_recommendations(p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_seed integer DEFAULT 0)
 RETURNS SETOF book_reco
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 -- The candidate probe asks for 400 neighbours but hnsw.ef_search defaults to
 -- 40, so it was silently returning 40 — the semantic pool feeding the whole
 -- ranking was a tenth of what the code intended. 100 measured 13 ms warm
 -- against 6 ms at 40, and going further is not worth it on this instance
 -- (ef=400 costs 1 489 ms). A function-level SET is used because SET LOCAL is
 -- illegal inside a non-volatile function.
 SET hnsw.ef_search TO '100'
AS $function$
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
  -- NB: no SET LOCAL in the body — Postgres forbids SET inside a non-volatile
  -- function, and this one is STABLE. ef_search is raised via the function's
  -- own SET clause above instead.

  select avg(b.embedding) into v_taste
  from public.books b
  join public.user_books ub on ub.book_id = b.id
  where ub.user_id = v_user
    and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
    and b.embedding is not null;

  -- Bounded candidate set. v_taste is a PL/pgSQL variable, so the ORDER BY is
  -- index-scannable (this is what turns a 67k seq scan into an index probe).
  -- The vector must be inlined as a literal: with a plain PL/pgSQL variable the
  -- cached generic plan ignores books_embedding_halfvec_hnsw and falls back to a
  -- sequential scan. Measured on this catalogue: parameter 1010 ms vs
  -- literal 6 ms for the identical top-400 probe.
  if v_taste is not null then
    execute format(
      'select array_agg(s.id) from ('
      || 'select b.id from public.books b where b.embedding is not null '
      || 'order by (b.embedding::extensions.halfvec(512)) '
      || '<=> %L::extensions.halfvec(512) limit 400) s',
      v_taste::extensions.halfvec(512)::text
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
$function$;

grant execute on function public.get_recommendations(int, int, int) to authenticated, anon;

CREATE OR REPLACE FUNCTION public.get_home_sections(p_seed integer DEFAULT 0, p_max_sections integer DEFAULT 5, p_per_section integer DEFAULT 12)
 RETURNS TABLE(section_key text, section_title text, section_rank integer, id uuid, title text, subtitle text, authors text[], cover_url text, published_year integer, categories text[], avg_rating numeric, reads_count integer, saves_count integer, likes_count integer, reviews_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_user  uuid := auth.uid();
  v_specs jsonb := '[]'::jsonb;
  v_spec  jsonb;
  v_rank  int := 0;
  v_emb   text;
begin
  -- Anchor books: things the reader demonstrably liked, rotated by the seed so
  -- "Perché hai letto…" isn't always about the same book.
  v_specs := v_specs || (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'similar_to_book', 'ref', b.id::text,
             'title', 'Perché hai letto ' || b.title)), '[]'::jsonb)
    from (
      select b.id, b.title
      from public.books b
      join public.user_books ub on ub.book_id = b.id
      where ub.user_id = v_user
        and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
        and b.embedding is not null
      order by abs(hashtext(b.id::text || ':' || p_seed::text))
      limit 3
    ) b
  );

  -- Authors they rated highly.
  v_specs := v_specs || (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'more_by_author', 'ref', a.author,
             'title', 'Ancora ' || a.author)), '[]'::jsonb)
    from (
      select distinct unnest(b.authors) as author
      from public.books b
      join public.user_books ub on ub.book_id = b.id
      where ub.user_id = v_user
        and (ub.liked or coalesce(ub.rating, 0) >= 4)
      order by 1
      limit 6
    ) a
    where a.author is not null
  );

  -- Dominant themes from the reader's taste clusters / explicit prefs.
  v_specs := v_specs || (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'theme', 'ref', t.cat,
             'title', 'Il tuo filone: ' || initcap(replace(t.cat, '-', ' ')))), '[]'::jsonb)
    from (
      select unnest(b.categories) as cat
      from public.books b
      join public.user_taste_clusters tc on tc.medoid_book_id = b.id
      where tc.user_id = v_user
      union
      select genre_slug from public.user_genre_prefs where user_id = v_user
      limit 8
    ) t
    where t.cat is not null
  );

  -- Editorial angles that stay meaningful without personal history.
  v_specs := v_specs || jsonb_build_array(
    jsonb_build_object('kind', 'free_classics', 'ref', '', 'title', 'Classici da leggere gratis, ora'),
    jsonb_build_object('kind', 'short_reads',   'ref', '', 'title', 'Brevi: finiscili in una sera'),
    jsonb_build_object('kind', 'acclaimed',     'ref', '', 'title', 'Acclamati dai lettori di tutto il mondo'),
    jsonb_build_object('kind', 'hidden_gems',   'ref', '', 'title', 'Piccole gemme da scoprire')
  );

  -- Pick and order the rows for this seed.
  for v_spec in
    select s.spec from (
      select value as spec
      from jsonb_array_elements(v_specs) value
      order by abs(hashtext((value->>'kind') || (value->>'ref') || ':' || p_seed::text))
      limit greatest(p_max_sections, 1)
    ) s
  loop
    v_rank := v_rank + 1;

    if v_spec->>'kind' = 'similar_to_book' then
      -- Semantic neighbours of the anchor book. The vector is inlined so the
      -- HNSW index is used (a bound parameter falls back to a seq scan).
      select b.embedding::extensions.halfvec(512)::text into v_emb
        from public.books b where b.id = (v_spec->>'ref')::uuid;
      if v_emb is null then continue; end if;
      return query execute format($q$
        select %L::text, %L::text, %s::int,
               b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
               case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
               b.reads_count, b.saves_count, b.likes_count, b.reviews_count
        from public.books b
        where b.embedding is not null and b.cover_url is not null
          and b.id <> %L::uuid
          and not exists (select 1 from public.user_books ub where ub.user_id = %L::uuid and ub.book_id = b.id)
        order by (b.embedding::extensions.halfvec(512)) <=> %L::extensions.halfvec(512)
        limit %s
      $q$, v_spec->>'kind' || ':' || (v_spec->>'ref'), v_spec->>'title', v_rank,
           v_spec->>'ref', v_user, v_emb, p_per_section);

    elsif v_spec->>'kind' = 'more_by_author' then
      return query
      select (v_spec->>'kind') || ':' || (v_spec->>'ref'), v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where (v_spec->>'ref') = any(b.authors)
        and b.cover_url is not null
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      order by (b.reads_count + b.likes_count + b.saves_count) desc, b.published_year desc nulls last
      limit p_per_section;

    elsif v_spec->>'kind' = 'theme' then
      return query
      select (v_spec->>'kind') || ':' || (v_spec->>'ref'), v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where (v_spec->>'ref') = any(b.categories)
        and b.cover_url is not null
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      order by (coalesce(b.external_rating, 0) * ln(2 + coalesce(b.external_ratings_count, 0))) desc,
               (b.reads_count + b.likes_count) desc
      limit p_per_section;

    elsif v_spec->>'kind' = 'free_classics' then
      return query
      select v_spec->>'kind', v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where b.free_read_url is not null and b.cover_url is not null
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      order by (coalesce(b.external_rating, 0) * ln(2 + coalesce(b.external_ratings_count, 0)))
               * (0.5 + (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000)::numeric / 1000) desc
      limit p_per_section;

    elsif v_spec->>'kind' = 'short_reads' then
      return query
      select v_spec->>'kind', v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where b.page_count between 40 and 200 and b.cover_url is not null
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      order by (coalesce(b.external_rating, 0) * ln(2 + coalesce(b.external_ratings_count, 0)))
               * (0.5 + (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000)::numeric / 1000) desc
      limit p_per_section;

    elsif v_spec->>'kind' = 'acclaimed' then
      return query
      select v_spec->>'kind', v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where coalesce(b.external_rating, 0) >= 4.2
        and coalesce(b.external_ratings_count, 0) >= 500
        and b.cover_url is not null
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      order by (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000) desc
      limit p_per_section;

    else -- hidden_gems: well rated but not yet mainstream
      return query
      select v_spec->>'kind', v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where coalesce(b.external_rating, 0) >= 4.0
        and coalesce(b.external_ratings_count, 0) between 20 and 400
        and b.cover_url is not null
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      order by (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000) desc
      limit p_per_section;
    end if;
  end loop;
end;
$function$;

grant execute on function public.get_home_sections(int, int, int) to authenticated;

-- pg_prewarm makes residency deterministic instead of hoping a probe happens to
-- touch the right pages. At 88 MB index + 51 MB heap against 224 MB of
-- shared_buffers everything now fits, so this keeps it there: the blocks are
-- already resident on the common path, making each pass a buffer lookup rather
-- than a read.
create extension if not exists pg_prewarm with schema extensions;

CREATE OR REPLACE FUNCTION public.internal_keep_vectors_warm()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v text;
begin
  set local hnsw.ef_search = 100;

  perform extensions.pg_prewarm('public.books_embedding_halfvec_hnsw', 'buffer');
  perform extensions.pg_prewarm('public.books', 'buffer');

  -- Was `order by embedding <=> v` with v a plain variable: that plans as a
  -- sequential scan, so the job warmed the heap and never touched the graph it
  -- exists to keep resident. Inlining the literal makes it a real index probe.
  select embedding::extensions.halfvec(512)::text into v
  from public.books where embedding is not null limit 1;
  if v is not null then
    execute format(
      'select 1 from public.books where embedding is not null '
      || 'order by (embedding::extensions.halfvec(512)) <=> %L::extensions.halfvec(512) limit 64',
      v
    );
  end if;
end;
$function$;

revoke execute on function public.internal_keep_vectors_warm() from public, anon, authenticated;


-- Only once the new index is in place and every reader uses it: reclaim the
-- 176 MB the full-precision graph was holding.
drop index if exists public.books_embedding_hnsw;

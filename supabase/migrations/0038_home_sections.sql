-- =====================================================================
-- 0038 — a home that reacts to the reader
--
--  1. get_continue_reading  — Netflix's "Continue watching": books actually
--     started (reading progress or the 'reading' shelf), most recent first,
--     finished ones dropped. Carries percent + bookmark so the row can show a
--     progress bar and resume.
--
--  2. get_home_sections    — personalised, *named* rows instead of bare genre
--     lists: "Perché hai letto X", "Ancora <autore>", "Il tuo filone: <tema>",
--     plus angles like free classics / short reads / acclaimed. Which rows
--     appear (and their order) is chosen by p_seed, so pull-to-refresh reveals
--     different sections — the categories stop feeling frozen.
--
--  3. amazon_affiliate_url — was pointing at amazon.COM and searching by ISBN,
--     so Italian readers landed on foreign-language editions (the stored ISBN is
--     often the English one). Now amazon.it, and ISBN is used only when we know
--     the edition is Italian; otherwise title+author, which the .it store
--     resolves to the Italian edition.
-- =====================================================================

-- ---------------------------------------------------------------- 1. resume
create or replace function public.get_continue_reading(p_limit int default 12)
returns table (
  id uuid, title text, subtitle text, authors text[], cover_url text,
  published_year int, categories text[], avg_rating numeric,
  reads_count int, saves_count int, likes_count int, reviews_count int,
  percent numeric, bookmark_percent numeric, free_read_url text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with started as (
    -- Progress-based (the reader opened the book) …
    select rp.book_id, rp.percent, rp.bookmark_percent, rp.updated_at
    from public.book_read_progress rp
    where rp.user_id = auth.uid()
      and rp.percent > 0.5 and rp.percent < 97
    union
    -- … or explicitly shelved as "sto leggendo".
    select ub.book_id, coalesce(rp.percent, 0), rp.bookmark_percent,
           greatest(coalesce(rp.updated_at, ub.started_at, now()), coalesce(ub.started_at, now()))
    from public.user_books ub
    left join public.book_read_progress rp
      on rp.book_id = ub.book_id and rp.user_id = ub.user_id
    where ub.user_id = auth.uid() and ub.status = 'reading'
  ),
  latest as (
    select s.book_id, max(s.percent) as percent,
           max(s.bookmark_percent) as bookmark_percent, max(s.updated_at) as updated_at
    from started s group by s.book_id
  )
  select
    b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
    case when b.rating_count > 0
         then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
    b.reads_count, b.saves_count, b.likes_count, b.reviews_count,
    round(l.percent, 1), l.bookmark_percent, b.free_read_url
  from latest l
  join public.books b on b.id = l.book_id
  -- Finished books drop out of the row, like Netflix.
  where not exists (
    select 1 from public.user_books ub2
    where ub2.user_id = auth.uid() and ub2.book_id = l.book_id and ub2.status in ('read', 'dnf')
  )
  order by l.updated_at desc
  limit greatest(p_limit, 0);
$$;
grant execute on function public.get_continue_reading(int) to authenticated;

-- ------------------------------------------------------- 2. named sections
create or replace function public.get_home_sections(
  p_seed         int default 0,
  p_max_sections int default 5,
  p_per_section  int default 12
)
returns table (
  section_key   text,
  section_title text,
  section_rank  int,
  id uuid, title text, subtitle text, authors text[], cover_url text,
  published_year int, categories text[], avg_rating numeric,
  reads_count int, saves_count int, likes_count int, reviews_count int
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
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
      select b.embedding::text into v_emb from public.books b where b.id = (v_spec->>'ref')::uuid;
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
        order by b.embedding <=> %L::extensions.vector
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
$$;
grant execute on function public.get_home_sections(int, int, int) to authenticated, anon;

-- --------------------------------------------- 3. buy link: right storefront
create or replace function public.amazon_affiliate_url(p_isbn text)
returns text
language sql
stable
set search_path = public
as $$
  -- Kept for backwards compatibility: ISBN search on the Italian storefront.
  select case
    when p_isbn is null or p_isbn = '' then null
    else 'https://www.amazon.it/s?k=' || p_isbn || '&i=stripbooks&tag=' ||
         coalesce((select value #>> '{}' from public.app_config where key = 'amazon_affiliate_tag'),
                  'jacopoz-21')
  end
$$;

-- Preferred entry point: picks the search term that actually lands on the
-- edition an Italian reader wants. A stored ISBN is frequently the English
-- edition, so it is only trusted when the row is known to be Italian.
create or replace function public.amazon_buy_url(p_book_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'https://www.amazon.it/s?k=' || public.urlencode(
           case
             when b.language = 'it' and coalesce(b.isbn_13, '') <> '' then b.isbn_13
             else b.title || ' ' || coalesce(b.authors[1], '')
           end
         ) || '&i=stripbooks&tag=' ||
         coalesce((select value #>> '{}' from public.app_config where key = 'amazon_affiliate_tag'),
                  'jacopoz-21')
  from public.books b where b.id = p_book_id;
$$;
grant execute on function public.amazon_buy_url(uuid) to authenticated, anon;

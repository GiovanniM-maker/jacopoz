-- =====================================================================
-- 0046 — make search fast again (regression I introduced in 0042)
--
-- Adding one-row-per-work to search cost two orders of magnitude: measured
-- 2 000–20 000 ms per query, against ~80 ms before. Three causes, all in the
-- shape of the query rather than the data — the predicates themselves match only
-- 8–39 rows:
--
--  1. `select b.*` in the CTE dragged the 512-dimension embedding (~2 KB/row)
--     through every sort, window and materialisation step.
--  2. The `term = '' OR tsv @@ … OR unaccent(title) % …` disjunction stops the
--     planner using either index, so it degenerated to a sequential scan that
--     recomputed immutable_unaccent(title) for all 67 583 rows.
--  3. The row_number() window ran over that entire unbounded set, before LIMIT.
--
-- Fix: build a bounded candidate id set from separate, individually
-- index-friendly branches (each with the search term inlined so it is a constant
-- for the planner), then join back for only the columns book_card needs, and
-- window over those few hundred rows.
-- =====================================================================

create or replace function public.search_books(
  p_query  text default '',
  p_limit  int  default 20,
  p_offset int  default 0,
  p_lang   text default null
)
returns setof public.book_card
language sql
stable
security definer
set search_path = public, extensions
-- The trigram branch was the single most expensive step: at the default
-- threshold of 0.3 the GIN scan hands back thousands of candidates and the
-- bitmap heap recheck recomputes immutable_unaccent(title) across ~1 700 heap
-- blocks. Measured for 'amore': 621 ms at 0.3, 22 ms at 0.4. Recall barely
-- suffers because whole-title similarity is dominated by length anyway —
-- partial-title queries are served by the full-text branch, and this branch's
-- job is typos ("a ciascuno il sur"). A function-level SET is used rather than
-- SET LOCAL, which Postgres rejects inside a non-volatile function.
set pg_trgm.similarity_threshold = 0.4
as $$
  with cand as (
    -- Empty query: just the popular shelf.
    (
      select b.id
      from public.books b
      where public.immutable_unaccent(trim(coalesce(p_query, ''))) = ''
      order by (b.reads_count + b.saves_count + b.likes_count) desc
      limit 200
    )
    union
    -- Full-text match (GIN on search_tsv).
    (
      select b.id
      from public.books b
      where public.immutable_unaccent(trim(coalesce(p_query, ''))) <> ''
        and b.search_tsv @@ websearch_to_tsquery(
              'simple', public.immutable_unaccent(trim(coalesce(p_query, ''))))
      limit 400
    )
    union
    -- Fuzzy title match (GIN trigram on immutable_unaccent(title)) — catches
    -- typos and partial titles.
    (
      select b.id
      from public.books b
      where public.immutable_unaccent(trim(coalesce(p_query, ''))) <> ''
        and public.immutable_unaccent(b.title)
            % public.immutable_unaccent(trim(coalesce(p_query, '')))
      limit 400
    )
  ),
  hits as (
    select
      b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
      b.categories, b.rating_sum, b.rating_count,
      b.reads_count, b.saves_count, b.likes_count, b.reviews_count,
      b.language, b.work_key,
      coalesce(
        nullif(p_lang, ''),
        (select pr.reading_language from public.profiles pr where pr.id = auth.uid()),
        'it'
      ) as pref,
      case
        when public.immutable_unaccent(trim(coalesce(p_query, ''))) = '' then 0
        else ts_rank(b.search_tsv, websearch_to_tsquery(
               'simple', public.immutable_unaccent(trim(coalesce(p_query, '')))))
             + similarity(public.immutable_unaccent(b.title),
                          public.immutable_unaccent(trim(coalesce(p_query, ''))))
             + case
                 when b.language = coalesce(
                        nullif(p_lang, ''),
                        (select pr.reading_language from public.profiles pr where pr.id = auth.uid()),
                        'it')
                 then 0.45 else 0
               end
             + case when b.cover_url is not null then 0.05 else 0 end
      end as rank
    from public.books b
    join cand c on c.id = b.id
  ),
  ranked as (
    select h.*,
      row_number() over (
        -- Rows with no work_key fall back to their own id so they never group.
        partition by coalesce(nullif(h.work_key, ''), h.id::text)
        order by
          (h.language = h.pref) desc,
          (h.cover_url is not null) desc,
          h.rank desc,
          (h.reads_count + h.saves_count + h.likes_count + h.reviews_count) desc
      ) as edition_rank
    from hits h
  )
  select
    r.id, r.title, r.subtitle, r.authors, r.cover_url, r.published_year, r.categories,
    case when r.rating_count > 0
         then round(r.rating_sum::numeric / r.rating_count, 2) else null end as avg_rating,
    r.reads_count, r.saves_count, r.likes_count, r.reviews_count
  from ranked r
  where r.edition_rank = 1
  order by r.rank desc, (r.reads_count + r.saves_count + r.likes_count) desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;
grant execute on function public.search_books(text, int, int, text) to authenticated, anon;

-- The pre-0041 three-argument overload is unreachable (every caller passes
-- p_lang) and still carried the slow definition. Drop it so nothing can fall
-- back onto it.
drop function if exists public.search_books(text, int, int);

-- search_authors was doing a sequential scan (~500 ms): it unnests authors for
-- every row, so the filter could never run before the unnest. A trigram index
-- over the flattened array lets the rows be narrowed first.
--
-- array_to_string is only STABLE (its output depends on the element type's
-- output function), so it cannot appear in an index expression directly. For
-- text[] it is in fact immutable, hence this wrapper.
create or replace function public.authors_text(p_authors text[])
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select public.immutable_unaccent(coalesce(array_to_string(p_authors, ' '), ''));
$$;

create index if not exists books_authors_trgm_idx
  on public.books using gin (public.authors_text(authors) gin_trgm_ops);

-- Narrow to the books whose author list contains the term, then unnest only
-- those handful of rows.
create or replace function public.search_authors(
  p_query text,
  p_limit int default 30
)
returns table (author text, book_count int)
language sql
stable
set search_path = public, extensions
as $$
  with cand as (
    select b.authors
    from public.books b
    where trim(coalesce(p_query, '')) <> ''
      and public.authors_text(b.authors)
          ilike '%' || public.immutable_unaccent(trim(coalesce(p_query, ''))) || '%'
  )
  select a.author, count(*)::int as book_count
  from cand c, unnest(c.authors) as a(author)
  where public.immutable_unaccent(a.author)
        ilike '%' || public.immutable_unaccent(trim(coalesce(p_query, ''))) || '%'
  group by a.author
  order by book_count desc, a.author
  limit greatest(p_limit, 0);
$$;
grant execute on function public.search_authors(text, int) to authenticated, anon;

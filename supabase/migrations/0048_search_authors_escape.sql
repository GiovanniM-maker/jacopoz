-- =====================================================================
-- 0048 — stop LIKE metacharacters in the author query acting as wildcards
--
-- search_authors interpolates the reader's text straight into an ILIKE
-- pattern, so typing "%" matched every author in the catalogue and "_" matched
-- any single character. Harmless but wrong: a stray keystroke returned the
-- whole catalogue rather than nothing, and a real surname containing an
-- underscore could not be searched for literally.
--
-- Escaping is with a backslash, so the backslash itself has to be escaped
-- first, otherwise "\" alone becomes a dangling escape and Postgres errors.
-- =====================================================================

create or replace function public.search_authors(
  p_query text,
  p_limit int default 30
)
returns table (author text, book_count int)
language sql
stable
set search_path = public, extensions
as $$
  with term as (
    select
      trim(coalesce(p_query, '')) as raw,
      '%' || replace(replace(replace(
        public.immutable_unaccent(trim(coalesce(p_query, ''))),
        '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  ),
  cand as (
    select b.authors
    from public.books b, term t
    where t.raw <> ''
      and public.authors_text(b.authors) ilike t.pat escape '\'
  )
  select a.author, count(*)::int as book_count
  from cand c, unnest(c.authors) as a(author), term t
  where public.immutable_unaccent(a.author) ilike t.pat escape '\'
  group by a.author
  order by book_count desc, a.author
  limit greatest(p_limit, 0);
$$;
grant execute on function public.search_authors(text, int) to authenticated, anon;

-- =====================================================================
-- 0016_search_authors
-- Author search: authors are stored as text[] on books, so we unnest and
-- aggregate. Returns each matching author with how many books we hold.
-- =====================================================================
create or replace function public.search_authors(
  p_query text,
  p_limit int default 30
)
returns table (author text, book_count int)
language sql
stable
as $$
  select a.author, count(*)::int as book_count
  from public.books b, unnest(b.authors) as a(author)
  where public.immutable_unaccent(a.author) ilike
        '%' || public.immutable_unaccent(trim(coalesce(p_query, ''))) || '%'
    and trim(coalesce(p_query, '')) <> ''
  group by a.author
  order by book_count desc, a.author
  limit greatest(p_limit, 0);
$$;

grant execute on function public.search_authors(text, int) to authenticated, anon;

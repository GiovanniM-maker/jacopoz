-- =====================================================================
-- 0045 — "gratis" flag for covers
--
-- Half the catalogue (33 308 of 67 583) is readable free in-app, and nothing on
-- a cover said so. The flag has to appear wherever a cover is drawn: home rows,
-- search grid, profile shelves, and the book strip inside feed posts. Those
-- surfaces are fed by three different composite types (book_card, book_reco,
-- feed_item) across ~10 functions, so widening the types would mean rewriting
-- the whole read path. This is additive instead: one small lookup by id that any
-- surface can use, whatever produced its rows.
-- =====================================================================
create or replace function public.get_free_flags(p_ids uuid[])
returns table (id uuid, is_free boolean)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, (b.free_read_url is not null) as is_free
  from public.books b
  where b.id = any(coalesce(p_ids, '{}'::uuid[]));
$$;
grant execute on function public.get_free_flags(uuid[]) to authenticated, anon;

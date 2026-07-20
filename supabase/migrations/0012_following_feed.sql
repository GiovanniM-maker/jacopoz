-- =====================================================================
-- 0012_following_feed
-- The "Following" feed variant: reviews from people you follow, newest
-- first (chronological — you don't want your friends' posts re-ranked).
-- Reuses the feed_item shape from 0006 so the app renders it identically.
-- =====================================================================
create or replace function public.get_following_feed(
  p_limit  int default 20,
  p_offset int default 0
)
returns setof public.feed_item
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id, r.book_id, b.title, b.cover_url, b.authors,
    p.id, p.username, p.display_name, p.avatar_url,
    r.rating, r.body, r.contains_spoilers,
    r.like_count, r.comment_count, r.created_at,
    exists (
      select 1 from public.likes l
      where l.user_id = auth.uid() and l.target_type = 'review' and l.target_id = r.id
    ) as viewer_has_liked,
    0::numeric as score
  from public.reviews r
  join public.books b on b.id = r.book_id
  join public.profiles p on p.id = r.user_id
  where r.status = 'visible'
    and r.user_id in (select following_id from public.follows where follower_id = auth.uid())
  order by r.created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

grant execute on function public.get_following_feed(int, int) to authenticated;

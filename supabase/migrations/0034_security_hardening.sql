-- =====================================================================
-- 0034 — Security & integrity hardening (audit findings)
--
--  1. CRITICAL: any authenticated user could PATCH their own profile row
--     setting role='admin' (the UPDATE policy didn't restrict columns) →
--     instant moderator. Lock writable columns to the harmless ones.
--  2. The per-entity counter triggers ran SECURITY INVOKER, so RLS blocked
--     them from updating other users'/books' rows (a follow couldn't bump
--     the followed user's followers_count) → silent counter drift. Make
--     them SECURITY DEFINER so they run as owner and bypass RLS. This both
--     fixes the drift AND is required once profile columns are locked.
--  3. internal_* maintenance RPCs were EXECUTE-able by anon (default PUBLIC
--     grant) → anyone with the public key could drive paid OpenRouter jobs.
--  4. Polymorphic likes/bookmarks (no FK) leaked when their review/comment
--     was deleted → orphan cleanup + triggers to prevent new orphans.
--  5. Missing indexes on foreign keys used by cascade deletes / lookups.
--  6. One-shot reconciliation of the counters drifted by (2).
-- =====================================================================

-- 1. Lock down profiles: clients may only edit presentation columns. role,
--    points and the denormalised counters are off-limits to client writes.
revoke update on public.profiles from authenticated, anon;
grant update (display_name, bio, avatar_url, onboarded_at) on public.profiles to authenticated;

-- 2. Counter/aggregate triggers → SECURITY DEFINER (owner = postgres), with a
--    pinned search_path. They contain only fixed counter arithmetic derived
--    from the already-RLS-validated triggering row, so running as owner is safe.
do $$
declare fn text;
begin
  foreach fn in array array[
    'follows_after_change','user_books_after_change','likes_after_change',
    'comments_after_change','reviews_after_change','book_list_items_after_change',
    'list_follows_after_change'
  ] loop
    execute format('alter function public.%I() security definer', fn);
    execute format('alter function public.%I() set search_path = public', fn);
  end loop;
end $$;

-- 3. Revoke the internal maintenance functions from every client role. They
--    are driven only by pg_cron (which runs as the table owner).
revoke execute on function
  public.internal_embed_enqueue(),
  public.internal_embed_enqueue_n(integer),
  public.internal_embed_ingest(),
  public.internal_embed_enqueue_reviews(),
  public.internal_enrich_enqueue(),
  public.internal_enrich_ingest(),
  public.internal_build_taste_clusters(),
  public.internal_build_cooccurrence()
from public, anon, authenticated;

-- 4. Polymorphic reference cleanup ------------------------------------------
-- Existing orphans (likes/bookmarks pointing at deleted reviews/comments).
delete from public.likes l where
  (l.target_type = 'review'  and not exists (select 1 from public.reviews  r where r.id = l.target_id))
  or (l.target_type = 'comment' and not exists (select 1 from public.comments c where c.id = l.target_id));
delete from public.bookmarks b where
  (b.target_type = 'review'  and not exists (select 1 from public.reviews  r where r.id = b.target_id))
  or (b.target_type = 'comment' and not exists (select 1 from public.comments c where c.id = b.target_id));

-- Prevent new orphans: when a review/comment is deleted, drop its likes/bookmarks.
create or replace function public.cleanup_review_refs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.likes     where target_type = 'review' and target_id = old.id;
  delete from public.bookmarks where target_type = 'review' and target_id = old.id;
  return old;
end $$;
drop trigger if exists reviews_cleanup_refs on public.reviews;
create trigger reviews_cleanup_refs after delete on public.reviews
  for each row execute function public.cleanup_review_refs();

create or replace function public.cleanup_comment_refs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.likes     where target_type = 'comment' and target_id = old.id;
  delete from public.bookmarks where target_type = 'comment' and target_id = old.id;
  return old;
end $$;
drop trigger if exists comments_cleanup_refs on public.comments;
create trigger comments_cleanup_refs after delete on public.comments
  for each row execute function public.cleanup_comment_refs();

-- 5. Missing FK indexes (cascade deletes & lookups) --------------------------
create index if not exists notifications_actor_idx        on public.notifications(actor_id);
create index if not exists notifications_review_idx       on public.notifications(review_id);
create index if not exists notifications_comment_idx      on public.notifications(comment_id);
create index if not exists reco_impressions_book_idx      on public.reco_impressions(book_id);
create index if not exists book_read_progress_book_idx    on public.book_read_progress(book_id);
create index if not exists book_dismissals_book_idx       on public.book_dismissals(book_id);
create index if not exists user_blocks_blocked_idx        on public.user_blocks(blocked_id);
create index if not exists user_genre_prefs_genre_idx     on public.user_genre_prefs(genre_slug);

-- 6. Reconcile counters drifted while the triggers ran INVOKER ---------------
update public.books b set
  likes_count  = (select count(*) from public.user_books ub where ub.book_id = b.id and ub.liked),
  rating_count = (select count(*) from public.user_books ub where ub.book_id = b.id and ub.rating is not null),
  rating_sum   = (select coalesce(sum(ub.rating),0) from public.user_books ub where ub.book_id = b.id and ub.rating is not null),
  reviews_count = (select count(*) from public.reviews r where r.book_id = b.id and coalesce(r.status,'visible') <> 'removed')
where exists (select 1 from public.user_books ub where ub.book_id = b.id)
   or exists (select 1 from public.reviews r where r.book_id = b.id);

update public.profiles p set
  followers_count  = (select count(*) from public.follows f where f.following_id = p.id),
  following_count  = (select count(*) from public.follows f where f.follower_id = p.id),
  books_read_count = (select count(*) from public.user_books ub where ub.user_id = p.id and ub.status = 'read');

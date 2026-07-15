-- =====================================================================
-- 0004_rls_policies
-- Row Level Security. Default deny; policies grant the minimum needed.
-- Reads are intentionally open (public reading community); writes are
-- owner-scoped. Ingestion and moderation use privileged paths:
--   * Book catalog writes -> service_role (Edge Function), bypasses RLS.
--   * Moderation           -> SECURITY DEFINER RPCs guarded by is_moderator().
-- =====================================================================

-- is_moderator(): true when the current user has an elevated role.
-- SECURITY DEFINER so it can read profiles regardless of the caller's RLS.
create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('moderator', 'admin')
  )
$$;

-- --- profiles ---------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles are readable by everyone"
  on public.profiles for select
  using (true);

create policy "users update their own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());
-- INSERT happens via the on_auth_user_created trigger (SECURITY DEFINER);
-- no client INSERT policy on purpose. DELETE cascades from auth.users.

-- --- genres (reference data) -----------------------------------------
alter table public.genres enable row level security;
create policy "genres are readable by everyone"
  on public.genres for select using (true);

-- --- books + external ids (read-only for clients) --------------------
alter table public.books enable row level security;
create policy "books are readable by everyone"
  on public.books for select using (true);

alter table public.book_external_ids enable row level security;
create policy "external ids are readable by everyone"
  on public.book_external_ids for select using (true);

-- --- user_books (public shelves, owner-only writes) ------------------
alter table public.user_books enable row level security;

create policy "shelves are readable by everyone"
  on public.user_books for select using (true);

create policy "users manage their own shelf (insert)"
  on public.user_books for insert
  with check (user_id = auth.uid());

create policy "users manage their own shelf (update)"
  on public.user_books for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "users manage their own shelf (delete)"
  on public.user_books for delete
  using (user_id = auth.uid());

-- --- reviews ----------------------------------------------------------
alter table public.reviews enable row level security;

create policy "visible reviews are readable by everyone"
  on public.reviews for select
  using (status = 'visible' or user_id = auth.uid() or public.is_moderator());

create policy "users create their own reviews"
  on public.reviews for insert
  with check (user_id = auth.uid());

create policy "authors or moderators update reviews"
  on public.reviews for update
  using (user_id = auth.uid() or public.is_moderator())
  with check (user_id = auth.uid() or public.is_moderator());

create policy "authors or moderators delete reviews"
  on public.reviews for delete
  using (user_id = auth.uid() or public.is_moderator());

-- --- comments ---------------------------------------------------------
alter table public.comments enable row level security;

create policy "visible comments are readable by everyone"
  on public.comments for select
  using (status = 'visible' or user_id = auth.uid() or public.is_moderator());

create policy "users create their own comments"
  on public.comments for insert
  with check (user_id = auth.uid());

create policy "authors or moderators update comments"
  on public.comments for update
  using (user_id = auth.uid() or public.is_moderator())
  with check (user_id = auth.uid() or public.is_moderator());

create policy "authors or moderators delete comments"
  on public.comments for delete
  using (user_id = auth.uid() or public.is_moderator());

-- --- likes ------------------------------------------------------------
alter table public.likes enable row level security;

create policy "likes are readable by everyone"
  on public.likes for select using (true);

create policy "users create their own likes"
  on public.likes for insert
  with check (user_id = auth.uid());

create policy "users delete their own likes"
  on public.likes for delete
  using (user_id = auth.uid());

-- --- follows ----------------------------------------------------------
alter table public.follows enable row level security;

create policy "follows are readable by everyone"
  on public.follows for select using (true);

create policy "users create their own follows"
  on public.follows for insert
  with check (follower_id = auth.uid());

create policy "users delete their own follows"
  on public.follows for delete
  using (follower_id = auth.uid());

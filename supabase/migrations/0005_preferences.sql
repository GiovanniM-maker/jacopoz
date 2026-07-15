-- =====================================================================
-- 0005_preferences
-- Explicit taste captured during onboarding. This is the primary signal
-- that solves the recommendation cold-start for brand-new users.
-- =====================================================================

create table public.user_genre_prefs (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  genre_slug text not null references public.genres (slug) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, genre_slug)
);

create index user_genre_prefs_user_idx on public.user_genre_prefs (user_id);

alter table public.user_genre_prefs enable row level security;

create policy "genre prefs are readable by everyone"
  on public.user_genre_prefs for select using (true);

create policy "users manage their own genre prefs (insert)"
  on public.user_genre_prefs for insert
  with check (user_id = auth.uid());

create policy "users manage their own genre prefs (delete)"
  on public.user_genre_prefs for delete
  using (user_id = auth.uid());

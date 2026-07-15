-- =====================================================================
-- 0007_moderation_analytics
-- User reports, a lightweight analytics event sink, and the activity
-- log that the (deferred) gamification layer will consume. Wiring the
-- table now means we never have to migrate a hot path later.
-- =====================================================================

-- --- reports ----------------------------------------------------------
create type public.report_target as enum ('review', 'comment', 'profile', 'book');
create type public.report_status as enum ('open', 'reviewing', 'resolved', 'dismissed');

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type public.report_target not null,
  target_id   uuid not null,
  reason      text not null check (char_length(reason) <= 80),
  note        text check (char_length(note) <= 500),
  status      public.report_status not null default 'open',
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  -- One open report per (reporter, target); re-reporting is a no-op.
  unique (reporter_id, target_type, target_id)
);

create index reports_status_idx on public.reports (status, created_at);

alter table public.reports enable row level security;

create policy "users file their own reports"
  on public.reports for insert
  with check (reporter_id = auth.uid());

create policy "moderators read reports"
  on public.reports for select
  using (public.is_moderator());

create policy "moderators update reports"
  on public.reports for update
  using (public.is_moderator())
  with check (public.is_moderator());

-- --- analytics_events -------------------------------------------------
-- Append-only. Clients write; only moderators/analysts read. For real
-- product analytics this is exported to a warehouse later; the table is
-- the durable buffer. Keep event names in a small documented vocabulary.
create table public.analytics_events (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles (id) on delete set null,
  name       text not null check (char_length(name) <= 60),
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index analytics_events_name_idx on public.analytics_events (name, created_at);
create index analytics_events_user_idx on public.analytics_events (user_id, created_at);

alter table public.analytics_events enable row level security;

create policy "authenticated users write their own events"
  on public.analytics_events for insert
  with check (user_id is null or user_id = auth.uid());

create policy "moderators read events"
  on public.analytics_events for select
  using (public.is_moderator());

-- --- activities (gamification scaffold) -------------------------------
-- Event log of noteworthy user actions. Unused by beta reads, but every
-- shelf/review/social action can be appended here so a future points
-- engine can replay history. No triggers wired yet on purpose.
create type public.activity_verb as enum (
  'finished_book', 'saved_book', 'liked_book',
  'wrote_review', 'commented', 'followed'
);

create table public.activities (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  verb        public.activity_verb not null,
  object_type text,
  object_id   uuid,
  created_at  timestamptz not null default now()
);

create index activities_user_idx on public.activities (user_id, created_at desc);

alter table public.activities enable row level security;

create policy "activities are readable by everyone"
  on public.activities for select using (true);

create policy "users write their own activities"
  on public.activities for insert
  with check (user_id = auth.uid());

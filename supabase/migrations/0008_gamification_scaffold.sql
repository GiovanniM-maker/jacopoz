-- =====================================================================
-- 0008_gamification_scaffold  (DESIGN ONLY — not wired in the beta)
--
-- Tables for levels, XP, streaks, badges and achievements. Reads are
-- public so a profile can show a level once the engine is switched on,
-- but there are NO client write policies: all mutations will go through
-- a future SECURITY DEFINER "points engine" (or service_role), so XP can
-- never be forged from the client. The append-only xp_ledger is the
-- source of truth; user_gamification.xp is a derived cache.
-- =====================================================================

-- Per-user aggregate state (level, xp cache, streak).
create table public.user_gamification (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  level          int  not null default 1,
  xp             int  not null default 0,          -- cache of sum(xp_ledger.amount)
  current_streak int  not null default 0,
  longest_streak int  not null default 0,
  last_active_on date,
  updated_at     timestamptz not null default now()
);

-- Append-only XP events; the ledger is the truth, the cache is derived.
create table public.xp_ledger (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  amount     int  not null,
  reason     text not null,                 -- e.g. 'finished_book', 'review_liked'
  ref_type   text,
  ref_id     uuid,
  created_at timestamptz not null default now()
);
create index xp_ledger_user_idx on public.xp_ledger (user_id, created_at desc);

-- Catalog of earnable things. kind distinguishes a one-off badge from a
-- repeatable achievement / milestone. Seeded as reference data.
create type public.achievement_kind as enum ('badge', 'achievement', 'milestone');

create table public.achievements (
  code        text primary key,             -- stable slug, referenced in code
  kind        public.achievement_kind not null default 'achievement',
  name        text not null,
  description text not null,
  icon        text,
  xp_reward   int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Which users earned what. Server-awarded only.
create table public.user_achievements (
  user_id          uuid not null references public.profiles (id) on delete cascade,
  achievement_code text not null references public.achievements (code) on delete cascade,
  earned_at        timestamptz not null default now(),
  primary key (user_id, achievement_code)
);
create index user_achievements_user_idx on public.user_achievements (user_id);

-- --- RLS: public read, no client writes (engine writes via service_role) ---
alter table public.user_gamification enable row level security;
create policy "gamification state is public"
  on public.user_gamification for select using (true);

alter table public.xp_ledger enable row level security;
create policy "users read their own xp ledger"
  on public.xp_ledger for select using (user_id = auth.uid());

alter table public.achievements enable row level security;
create policy "achievement catalog is public"
  on public.achievements for select using (true);

alter table public.user_achievements enable row level security;
create policy "earned achievements are public"
  on public.user_achievements for select using (true);

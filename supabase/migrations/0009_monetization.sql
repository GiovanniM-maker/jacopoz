-- =====================================================================
-- 0009_monetization
-- Three revenue channels, architected now, mostly dormant in the beta:
--   1. Affiliate links  -> ENABLED in beta (zero UX cost, real upside).
--   2. Premium (ad-free) -> entitlement modelled; nothing gated yet.
--   3. Ads               -> config present but DISABLED in beta.
--
-- Premium state is owned by the billing provider (RevenueCat/Stripe) and
-- written here by a webhook via service_role. app_config is a tiny global
-- key/value store for remote flags the client reads at launch.
-- =====================================================================

-- --- entitlements: one row per user, current subscription state --------
create type public.billing_tier as enum ('free', 'premium');

create table public.entitlements (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  tier               public.billing_tier not null default 'free',
  is_active          boolean not null default true,
  provider           text,                    -- 'revenuecat' | 'stripe' | 'promo'
  product_id         text,
  current_period_end timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger entitlements_set_updated_at
  before update on public.entitlements
  for each row execute function public.set_updated_at();

-- is_premium(): single source of truth for gating. Defaults to false when
-- no row exists (free). Used by the client and by future gated features.
create or replace function public.is_premium(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.entitlements
    where user_id = p_user
      and tier = 'premium'
      and is_active
      and (current_period_end is null or current_period_end > now())
  )
$$;

alter table public.entitlements enable row level security;
-- Users may read their own entitlement; only the billing webhook
-- (service_role, bypasses RLS) writes it. No client write policy.
create policy "users read their own entitlement"
  on public.entitlements for select using (user_id = auth.uid());

-- --- app_config: global remote flags read by the client ----------------
-- Seeded with the monetization switches. ads_enabled stays false for beta.
create table public.app_config (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

create trigger app_config_set_updated_at
  before update on public.app_config
  for each row execute function public.set_updated_at();

alter table public.app_config enable row level security;
create policy "app config is public read"
  on public.app_config for select using (true);
create policy "moderators write app config"
  on public.app_config for update using (public.is_moderator()) with check (public.is_moderator());

-- --- affiliate link builder --------------------------------------------
-- Amazon affiliate URLs are just an ISBN search plus the associate tag.
-- Keeping the tag in app_config means we rotate it without shipping an app
-- update. Returns null when no ISBN is known (button is hidden).
create or replace function public.amazon_affiliate_url(p_isbn text)
returns text
language sql
stable
as $$
  select case
    when p_isbn is null or p_isbn = '' then null
    else 'https://www.amazon.com/s?k=' || p_isbn || '&tag=' ||
         coalesce((select value #>> '{}' from public.app_config where key = 'amazon_affiliate_tag'),
                  'jacopoz-20')
  end
$$;

grant execute on function public.is_premium(uuid) to authenticated;
grant execute on function public.amazon_affiliate_url(text) to authenticated, anon;

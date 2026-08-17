-- =====================================================================
-- 0033 — Web Push (PWA) delivery of the return-loop notifications
--
-- In-app notifications (0032) only reach people already looking at the app.
-- This adds the actual push that lands on the phone when Tomo is closed:
--   • push_subscriptions — one row per installed device that opted in
--   • an AFTER INSERT trigger on notifications → fires the `send-push`
--     Edge Function via pg_net, which signs (VAPID) and encrypts the payload
--     and posts it to the browser's push service.
--
-- The Edge Function is authenticated with a shared secret read from Vault
-- (`push_dispatch_secret`), set out-of-band so it never lives in the repo.
-- The project URL is the same one that already ships publicly in the client.
-- =====================================================================

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
-- Users manage only their own device subscriptions. The Edge Function reads
-- them via the service role (bypasses RLS).
drop policy if exists push_select_own on public.push_subscriptions;
create policy push_select_own on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists push_insert_own on public.push_subscriptions;
create policy push_insert_own on public.push_subscriptions for insert with check (user_id = auth.uid());
drop policy if exists push_delete_own on public.push_subscriptions;
create policy push_delete_own on public.push_subscriptions for delete using (user_id = auth.uid());

-- Upsert a device subscription for the signed-in user. Endpoint is the
-- identity of the device+browser; re-subscribing refreshes the keys.
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        last_seen_at = now();
end $$;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- Drop a device subscription (e.g. the user revokes permission).
create or replace function public.delete_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions
  where endpoint = p_endpoint and user_id = auth.uid();
$$;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- Fire-and-forget: hand the new notification's id to the Edge Function, which
-- does the VAPID signing / payload encryption / delivery. pg_net queues the
-- request and sends it after commit, so this never blocks the write.
create or replace function public.internal_dispatch_push()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'push_dispatch_secret';
  if v_secret is null then return NEW; end if;

  perform net.http_post(
    url     := 'https://tpphaalfmcqtfxhyafzz.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', v_secret),
    body    := jsonb_build_object('notification_id', NEW.id),
    timeout_milliseconds := 8000
  );
  return NEW;
end $$;

drop trigger if exists dispatch_push on public.notifications;
create trigger dispatch_push after insert on public.notifications
  for each row execute function public.internal_dispatch_push();

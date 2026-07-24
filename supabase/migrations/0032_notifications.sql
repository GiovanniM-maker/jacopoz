-- =====================================================================
-- 0032 — notifications (the "return" loop)
--
-- Someone likes/comments your review, or follows you → a notification row.
-- Created by SECURITY DEFINER triggers (never by clients). The recipient
-- reads and marks their own. This is what pulls people back into the app.
-- =====================================================================

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,  -- recipient
  actor_id   uuid references public.profiles(id) on delete set null,          -- who acted
  type       text not null check (type in ('like', 'comment', 'follow')),
  review_id  uuid references public.reviews(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;
drop policy if exists notif_select_own on public.notifications;
create policy notif_select_own on public.notifications for select using (user_id = auth.uid());
drop policy if exists notif_update_own on public.notifications;
create policy notif_update_own on public.notifications for update using (user_id = auth.uid());

-- Like on a review → notify its author.
create or replace function public.tg_notify_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  if NEW.target_type = 'review' then
    select user_id into v_author from public.reviews where id = NEW.target_id;
    if v_author is not null and v_author <> NEW.user_id then
      insert into public.notifications (user_id, actor_id, type, review_id)
      values (v_author, NEW.user_id, 'like', NEW.target_id);
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists notify_like on public.likes;
create trigger notify_like after insert on public.likes
  for each row execute function public.tg_notify_like();

-- Comment on a review → notify its author.
create or replace function public.tg_notify_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_author uuid;
begin
  select user_id into v_author from public.reviews where id = NEW.review_id;
  if v_author is not null and v_author <> NEW.user_id then
    insert into public.notifications (user_id, actor_id, type, review_id, comment_id)
    values (v_author, NEW.user_id, 'comment', NEW.review_id, NEW.id);
  end if;
  return NEW;
end $$;
drop trigger if exists notify_comment on public.comments;
create trigger notify_comment after insert on public.comments
  for each row execute function public.tg_notify_comment();

-- New follower → notify the followed.
create or replace function public.tg_notify_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.following_id <> NEW.follower_id then
    insert into public.notifications (user_id, actor_id, type)
    values (NEW.following_id, NEW.follower_id, 'follow');
  end if;
  return NEW;
end $$;
drop trigger if exists notify_follow on public.follows;
create trigger notify_follow after insert on public.follows
  for each row execute function public.tg_notify_follow();

create or replace function public.mark_notifications_read()
returns void language sql security definer set search_path = public as $$
  update public.notifications set read = true where user_id = auth.uid() and not read;
$$;
grant execute on function public.mark_notifications_read() to authenticated;

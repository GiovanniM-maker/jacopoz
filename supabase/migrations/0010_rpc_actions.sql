-- =====================================================================
-- 0010_rpc_actions
-- Write-side RPCs for operations that are awkward or racy to do as raw
-- table calls from the client: like toggles, reporting, and moderation.
-- Shelf writes stay as plain upserts (RLS-guarded) — no RPC needed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- toggle_like(): idempotent like/unlike for a review or comment. Returns
-- the resulting state so the UI updates in one round trip. SECURITY
-- INVOKER — the likes RLS policies already scope rows to auth.uid().
-- ---------------------------------------------------------------------
create or replace function public.toggle_like(
  p_target_type public.likeable_type,
  p_target_id   uuid
)
returns table (liked boolean, like_count int)
language plpgsql
volatile
as $$
declare
  v_user uuid := auth.uid();
  v_deleted int;
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;

  delete from public.likes
    where user_id = v_user and target_type = p_target_type and target_id = p_target_id;
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    insert into public.likes (user_id, target_type, target_id)
      values (v_user, p_target_type, p_target_id);
    liked := true;
  else
    liked := false;
  end if;

  if p_target_type = 'review' then
    select r.like_count into like_count from public.reviews r where r.id = p_target_id;
  else
    select c.like_count into like_count from public.comments c where c.id = p_target_id;
  end if;
  return next;
end;
$$;

-- ---------------------------------------------------------------------
-- report_content(): file a report; re-reporting the same target is a
-- silent no-op (unique constraint). Returns nothing sensitive.
-- ---------------------------------------------------------------------
create or replace function public.report_content(
  p_target_type public.report_target,
  p_target_id   uuid,
  p_reason      text,
  p_note        text default null
)
returns void
language plpgsql
volatile
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;
  insert into public.reports (reporter_id, target_type, target_id, reason, note)
    values (v_user, p_target_type, p_target_id, left(p_reason, 80), left(p_note, 500))
  on conflict (reporter_id, target_type, target_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- moderate_content(): set the visibility of a review/comment. Guarded by
-- is_moderator(); SECURITY DEFINER so the moderator role is enough
-- regardless of ownership. Also resolves any open reports on the target.
-- ---------------------------------------------------------------------
create or replace function public.moderate_content(
  p_target_type public.likeable_type,   -- 'review' | 'comment'
  p_target_id   uuid,
  p_status      public.content_status
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required';
  end if;

  if p_target_type = 'review' then
    update public.reviews set status = p_status where id = p_target_id;
  else
    update public.comments set status = p_status where id = p_target_id;
  end if;

  update public.reports
    set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
    where target_type = p_target_type::text::public.report_target
      and target_id = p_target_id
      and status in ('open', 'reviewing');
end;
$$;

grant execute on function public.toggle_like(public.likeable_type, uuid) to authenticated;
grant execute on function public.report_content(public.report_target, uuid, text, text) to authenticated;
grant execute on function public.moderate_content(public.likeable_type, uuid, public.content_status) to authenticated;

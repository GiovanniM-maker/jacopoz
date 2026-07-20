-- =====================================================================
-- 0014_account_settings
-- Account deletion (GDPR "delete my data"). Deleting the auth user cascades
-- through profiles and every content table (all FK on delete cascade), so a
-- single delete wipes the user's footprint. SECURITY DEFINER so the caller
-- can only ever delete themselves (auth.uid()).
-- =====================================================================
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'authentication required';
  end if;
  -- Cascades to public.profiles and all owned rows (reviews, comments,
  -- likes, follows, lists, bookmarks, shelves, ...).
  delete from auth.users where id = v_user;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

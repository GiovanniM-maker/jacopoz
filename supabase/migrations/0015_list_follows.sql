-- =====================================================================
-- 0015_list_follows
-- Following other people's public booklists. Mirrors user follows: a join
-- table + a denormalized follower_count on book_lists.
-- =====================================================================
alter table public.book_lists add column if not exists follower_count int not null default 0;

create table public.list_follows (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  list_id    uuid not null references public.book_lists (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, list_id)
);
create index list_follows_user_idx on public.list_follows (user_id, created_at desc);
create index list_follows_list_idx on public.list_follows (list_id);

create or replace function public.list_follows_after_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.book_lists set follower_count = follower_count + 1 where id = new.list_id;
  elsif tg_op = 'DELETE' then
    update public.book_lists set follower_count = greatest(follower_count - 1, 0) where id = old.list_id;
  end if;
  return null;
end; $$;

create trigger list_follows_count_aid
  after insert or delete on public.list_follows
  for each row execute function public.list_follows_after_change();

alter table public.list_follows enable row level security;

create policy "list follows are readable by everyone"
  on public.list_follows for select using (true);

-- You can only follow a list you can actually see (public, or your own).
create policy "users follow visible lists"
  on public.list_follows for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.book_lists l
                where l.id = list_id and (l.is_public or l.user_id = auth.uid()))
  );

create policy "users unfollow their own list follows"
  on public.list_follows for delete
  using (user_id = auth.uid());

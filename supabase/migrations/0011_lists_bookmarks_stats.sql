-- =====================================================================
-- 0011_lists_bookmarks_stats
-- User-created book lists, saved (bookmarked) reviews/comments, and a
-- single RPC for the richer profile statistics (likes received, comments,
-- followers, ...). The fixed shelves (want_to_read/reading/read) stay;
-- lists are free-form collections on top.
-- =====================================================================

-- --- book_lists: user-created collections --------------------------------
create table public.book_lists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  is_public   boolean not null default true,
  book_count  int not null default 0,          -- maintained by trigger
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index book_lists_user_idx on public.book_lists (user_id, updated_at desc);

create trigger book_lists_set_updated_at
  before update on public.book_lists
  for each row execute function public.set_updated_at();

-- --- book_list_items: books inside a list --------------------------------
create table public.book_list_items (
  list_id   uuid not null references public.book_lists (id) on delete cascade,
  book_id   uuid not null references public.books (id) on delete cascade,
  note      text check (char_length(note) <= 300),
  added_at  timestamptz not null default now(),
  primary key (list_id, book_id)
);
create index book_list_items_book_idx on public.book_list_items (book_id);
create index book_list_items_list_idx on public.book_list_items (list_id, added_at desc);

-- Keep book_lists.book_count in sync.
create or replace function public.book_list_items_after_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.book_lists set book_count = book_count + 1 where id = new.list_id;
  elsif tg_op = 'DELETE' then
    update public.book_lists set book_count = greatest(book_count - 1, 0) where id = old.list_id;
  end if;
  return null;
end; $$;

create trigger book_list_items_count_aid
  after insert or delete on public.book_list_items
  for each row execute function public.book_list_items_after_change();

-- --- bookmarks: save reviews AND comments --------------------------------
create type public.bookmark_type as enum ('review', 'comment');

create table public.bookmarks (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  target_type public.bookmark_type not null,
  target_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);
create index bookmarks_user_idx on public.bookmarks (user_id, target_type, created_at desc);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.book_lists enable row level security;
create policy "public lists or owner are readable"
  on public.book_lists for select using (is_public or user_id = auth.uid());
create policy "owners create lists"
  on public.book_lists for insert with check (user_id = auth.uid());
create policy "owners update lists"
  on public.book_lists for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owners delete lists"
  on public.book_lists for delete using (user_id = auth.uid());

alter table public.book_list_items enable row level security;
create policy "list items readable when the list is"
  on public.book_list_items for select using (
    exists (select 1 from public.book_lists l
            where l.id = list_id and (l.is_public or l.user_id = auth.uid())));
create policy "owners add list items"
  on public.book_list_items for insert with check (
    exists (select 1 from public.book_lists l where l.id = list_id and l.user_id = auth.uid()));
create policy "owners remove list items"
  on public.book_list_items for delete using (
    exists (select 1 from public.book_lists l where l.id = list_id and l.user_id = auth.uid()));

alter table public.bookmarks enable row level security;
create policy "users read their own bookmarks"
  on public.bookmarks for select using (user_id = auth.uid());
create policy "users add their own bookmarks"
  on public.bookmarks for insert with check (user_id = auth.uid());
create policy "users remove their own bookmarks"
  on public.bookmarks for delete using (user_id = auth.uid());

-- =====================================================================
-- get_profile_stats(): one round trip for the profile numbers.
-- =====================================================================
create or replace function public.get_profile_stats(p_user uuid)
returns table (
  books_read     int,
  reviews        int,
  comments       int,
  likes_received int,
  likes_given    int,
  followers      int,
  following      int,
  lists          int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::int from user_books where user_id = p_user and status = 'read'),
    (select count(*)::int from reviews where user_id = p_user and status = 'visible'),
    (select count(*)::int from comments where user_id = p_user and status = 'visible'),
    (select coalesce(sum(like_count), 0)::int from reviews where user_id = p_user and status = 'visible')
      + (select coalesce(sum(like_count), 0)::int from comments where user_id = p_user and status = 'visible'),
    (select count(*)::int from likes where user_id = p_user),
    (select followers_count from profiles where id = p_user),
    (select following_count from profiles where id = p_user),
    (select count(*)::int from book_lists where user_id = p_user);
$$;

grant execute on function public.get_profile_stats(uuid) to authenticated, anon;

-- =====================================================================
-- 0023_reading
-- The reader: free public-domain books in-app (Project Gutenberg), and
-- real reading progress — which is the strong "slow" signal the reco
-- research said we lacked (no longer just shelved/finished, but WHERE in
-- the book you are).
-- =====================================================================

alter table public.books
  add column if not exists gutenberg_id         int,
  add column if not exists free_read_url        text,
  add column if not exists gutenberg_checked_at timestamptz;

-- Per-user reading position, 0..100.
create table if not exists public.book_read_progress (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  book_id    uuid not null references public.books(id) on delete cascade,
  percent    numeric not null default 0 check (percent between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);
alter table public.book_read_progress enable row level security;
create policy read_progress_all_own on public.book_read_progress
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Save progress; crossing 90% also marks the book read on the shelf, so
-- the strongest interaction weight (finished) flows into the algorithm.
create or replace function public.save_read_progress(p_book_id uuid, p_percent numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return; end if;
  insert into public.book_read_progress (user_id, book_id, percent, updated_at)
  values (v_user, p_book_id, greatest(0, least(100, p_percent)), now())
  on conflict (user_id, book_id) do update
    set percent = greatest(public.book_read_progress.percent, excluded.percent),
        updated_at = now();

  if p_percent >= 90 then
    insert into public.user_books (user_id, book_id, status, started_at, finished_at)
    values (v_user, p_book_id, 'read', now(), now())
    on conflict (user_id, book_id) do update
      set status = 'read', finished_at = coalesce(public.user_books.finished_at, now());
  elsif p_percent >= 3 then
    insert into public.user_books (user_id, book_id, status, started_at)
    values (v_user, p_book_id, 'reading', now())
    on conflict (user_id, book_id) do update
      set status = case when public.user_books.status = 'read' then 'read' else 'reading' end,
          started_at = coalesce(public.user_books.started_at, now());
  end if;
end;
$$;

grant execute on function public.save_read_progress(uuid, numeric) to authenticated;

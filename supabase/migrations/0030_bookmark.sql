-- =====================================================================
-- 0030 — reader bookmark
--
-- book_read_progress already tracks the auto-saved scroll position. A
-- bookmark is a *deliberate* marker the reader drops ("I'm here") and can
-- jump back to — separate from the continuously-updated progress. One
-- bookmark per (user, book).
-- =====================================================================

alter table public.book_read_progress
  add column if not exists bookmark_percent numeric check (bookmark_percent >= 0 and bookmark_percent <= 100);

-- Set (or clear, with null) the bookmark for a book.
create or replace function public.save_bookmark(p_book_id uuid, p_percent numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.book_read_progress (user_id, book_id, percent, bookmark_percent, updated_at)
  values (auth.uid(), p_book_id, 0, p_percent, now())
  on conflict (user_id, book_id) do update
    set bookmark_percent = excluded.bookmark_percent, updated_at = now();
end;
$$;

grant execute on function public.save_bookmark(uuid, numeric) to authenticated;

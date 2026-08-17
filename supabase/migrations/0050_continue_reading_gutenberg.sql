-- =====================================================================
-- 0050 — "Continua a leggere" was linking to a reader that cannot open
--
-- The in-app reader is addressed by Gutenberg id (/read/<gutenberg_id>), which
-- the book page passes correctly. The home row passed the book's uuid instead,
-- so Number(id) was NaN, the text query stayed disabled and the tap landed on
-- an empty screen for every free book.
--
-- The row needs the id to link properly, so return it. Also returned is
-- whether the free read is one we can render in-app at all: Google Books now
-- contributes public-domain and free-ebook links (its own web reader), which
-- are external pages rather than plain text.
-- =====================================================================

drop function if exists public.get_continue_reading(int);

create or replace function public.get_continue_reading(p_limit int default 12)
returns table (
  id uuid, title text, subtitle text, authors text[], cover_url text,
  published_year int, categories text[], avg_rating numeric,
  reads_count int, saves_count int, likes_count int, reviews_count int,
  percent numeric, bookmark_percent numeric, free_read_url text,
  gutenberg_id int
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with started as (
    -- Progress-based (the reader opened the book) …
    select rp.book_id, rp.percent, rp.bookmark_percent, rp.updated_at
    from public.book_read_progress rp
    where rp.user_id = auth.uid()
      and rp.percent > 0.5 and rp.percent < 97
    union
    -- … or explicitly shelved as "sto leggendo".
    select ub.book_id, coalesce(rp.percent, 0), rp.bookmark_percent,
           greatest(coalesce(rp.updated_at, ub.started_at, now()), coalesce(ub.started_at, now()))
    from public.user_books ub
    left join public.book_read_progress rp
      on rp.book_id = ub.book_id and rp.user_id = ub.user_id
    where ub.user_id = auth.uid() and ub.status = 'reading'
  ),
  latest as (
    select s.book_id, max(s.percent) as percent,
           max(s.bookmark_percent) as bookmark_percent, max(s.updated_at) as updated_at
    from started s group by s.book_id
  )
  select
    b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
    case when b.rating_count > 0
         then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
    b.reads_count, b.saves_count, b.likes_count, b.reviews_count,
    round(l.percent, 1), l.bookmark_percent, b.free_read_url, b.gutenberg_id
  from latest l
  join public.books b on b.id = l.book_id
  order by l.updated_at desc
  limit greatest(p_limit, 0);
$$;
grant execute on function public.get_continue_reading(int) to authenticated;

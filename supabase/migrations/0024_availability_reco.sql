-- =====================================================================
-- 0024 — availability-aware recommendations
--
-- Two new home rows need the same shape of data, split by whether the book
-- is free to read in-app or must be bought:
--   • "Gratis, consigliati per te"     → p_free = true  (free_read_url set)
--   • "Nuove scoperte · a pagamento"   → p_free = false (no free read)
--
-- Both are ranked by the caller's taste vector (avg embedding of their
-- positive books); with no history we fall back to popularity — and the
-- paid row leans toward newer titles ("scoperte"). Already-shelved and
-- dismissed books are excluded.
-- =====================================================================

create or replace function public.get_reco_by_availability(
  p_free   boolean,
  p_limit  int default 15
)
returns setof public.book_card
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_user  uuid := auth.uid();
  v_taste extensions.vector(512);
begin
  -- Taste vector: mean embedding of the user's liked / read / highly-rated books.
  select avg(b.embedding) into v_taste
  from public.user_books ub
  join public.books b on b.id = ub.book_id
  where ub.user_id = v_user
    and b.embedding is not null
    and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4);

  return query
  select
    b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
    b.categories, public.book_avg_rating(b) as avg_rating,
    b.reads_count, b.saves_count, b.likes_count, b.reviews_count
  from public.books b
  where
    case when p_free then b.free_read_url is not null
                     else b.gutenberg_id is null end
    and not exists (
      select 1 from public.user_books ub
      where ub.user_id = v_user and ub.book_id = b.id
    )
    and not exists (
      select 1 from public.book_dismissals d
      where d.user_id = v_user and d.book_id = b.id
    )
  order by
    -- 1) closeness to taste (0 for everyone when we have no taste vector yet)
    case
      when v_taste is not null and b.embedding is not null
      then greatest(0, 1 - (b.embedding <=> v_taste))
      else 0
    end desc,
    -- 2) paid row surfaces newer discoveries; free row ignores this
    case when p_free then 0 else coalesce(b.published_year, 0) end desc,
    -- 3) popularity as the final tie-breaker / cold-start ordering
    (b.reads_count * 3 + b.saves_count * 2 + b.likes_count * 2 + b.reviews_count) desc
  limit greatest(p_limit, 0);
end;
$$;

grant execute on function public.get_reco_by_availability(boolean, int) to authenticated, anon;

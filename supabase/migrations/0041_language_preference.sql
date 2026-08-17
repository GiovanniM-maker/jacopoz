-- =====================================================================
-- 0041 — reading language: pick one, then see your language first
--
-- Searching "la vegetariana" surfaced the Spanish/Catalan edition of Han Kang's
-- novel (its authors array even carries the translators, "Mihwa Jo; Gabi
-- Martínez"). The catalogue is multilingual — 39.5k en, 7.8k it, 5.7k pt, 5.1k
-- es, 4.7k de, 4.5k fr — and search ranked purely by text relevance, so an
-- Italian reader had no reason to be shown the Italian edition first.
--
-- Fix: store a reading language on the profile (default Italian), boost it in
-- search, and let the caller override it per query so the UI can offer filters
-- ("Italiano / Inglese / Tutte / Lingua originale").
--
-- The boost is additive on top of text relevance, so a strong title match in
-- another language still wins over a weak match in yours — you are never cut
-- off from a book, it just stops being buried.
-- =====================================================================

alter table public.profiles
  add column if not exists reading_language text not null default 'it';

-- Readers may set this themselves (it is a presentation preference).
-- 0034 revoked table-wide UPDATE, so grant this one column explicitly.
grant update (reading_language) on public.profiles to authenticated;

create or replace function public.search_books(
  p_query  text default '',
  p_limit  int  default 20,
  p_offset int  default 0,
  -- null → use the caller's profile preference; 'all' → no language boost;
  -- otherwise a 2-letter code to prefer.
  p_lang   text default null
)
returns setof public.book_card
language sql
stable
security definer
set search_path = public, extensions
as $$
  with q as (
    select
      public.immutable_unaccent(trim(coalesce(p_query, ''))) as term,
      coalesce(
        nullif(p_lang, ''),
        (select reading_language from public.profiles where id = auth.uid()),
        'it'
      ) as lang
  )
  select
    b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
    b.categories, public.book_avg_rating(b) as avg_rating,
    b.reads_count, b.saves_count, b.likes_count, b.reviews_count
  from public.books b, q
  where q.term = ''
     or b.search_tsv @@ websearch_to_tsquery('simple', q.term)
     or public.immutable_unaccent(b.title) % q.term
  order by
    case when q.term = '' then 0
         else ts_rank(b.search_tsv, websearch_to_tsquery('simple', q.term))
              + similarity(public.immutable_unaccent(b.title), q.term)
              -- Preferred language first, then a small nudge for having a cover
              -- (a complete row is usually the better edition).
              + case when q.lang <> 'all' and b.language = q.lang then 0.45 else 0 end
              + case when b.cover_url is not null then 0.05 else 0 end
    end desc,
    (b.reads_count + b.saves_count + b.likes_count) desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;
grant execute on function public.search_books(text, int, int, text) to authenticated, anon;

-- Which languages the catalogue actually has, for the filter UI.
create or replace function public.get_catalog_languages()
returns table (language text, book_count bigint)
language sql
stable
set search_path = public
as $$
  select b.language, count(*)
  from public.books b
  where b.language is not null
  group by b.language
  having count(*) >= 50
  order by count(*) desc;
$$;
grant execute on function public.get_catalog_languages() to authenticated, anon;

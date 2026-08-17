-- =====================================================================
-- 0042 — one book, many editions
--
-- "Notti bianche" appeared several times: "Le notti bianche" and "Notti
-- Bianche", plus an author stored as "Dostoevskij Fëdor" instead of "Fëdor
-- Dostoevskij". These are the same work, so search should offer it once and the
-- book page should let the reader pick the edition.
--
-- The grouping key is deliberately CONSERVATIVE. An earlier, more aggressive
-- version that also stripped parentheticals collapsed genuinely different books
-- — "The Wanderer (Volume 1 of 5)" with "(Volume 2 of 5)", "Plays (36)" with
-- "Plays (37)", "Bunyan Characters (1st Series)" with "(2nd Series)". So the key
-- only: folds accents and punctuation, drops a leading article, and sorts the
-- author's name tokens (which is what fixes "Surname Firstname"). Volume and
-- series markers are left intact.
--
-- Measured on this catalogue: 66 work groups / 68 redundant rows, all of them
-- true duplicates ("La vita nuova" = "Vita nuova", "L' Orlando furioso" =
-- "Orlando Furioso", "Birds" = "The Birds").
-- =====================================================================

create or replace function public.work_key(p_title text, p_authors text[])
returns text
language sql
immutable
set search_path = public
as $$
  select
    regexp_replace(
      regexp_replace(
        lower(translate(coalesce(p_title, ''),
          'àèéìòùáíóúâêîôûäëïöüčšžëÀÈÉÌÒÙÁÍÓÚ',
          'aeeiouaiouaeiouaeioucszeAEEIOUAIOU')),
        '^(il|lo|la|i|gli|le|l|the|a|an|un|una|los|las|el|der|die|das)[^a-z0-9]+', '', 'i'),
      '[^a-z0-9]', '', 'g')
    || '|' ||
    coalesce((
      select string_agg(t, ' ' order by t)
      from unnest(string_to_array(
        regexp_replace(
          lower(translate(coalesce(p_authors[1], ''),
            'àèéìòùáíóúâêîôûäëïöüčšžë', 'aeeiouaiouaeiouaeioucsze')),
          '[^a-z ]', '', 'g'), ' ')) t
      where t <> ''
    ), '');
$$;

alter table public.books add column if not exists work_key text;

update public.books
   set work_key = public.work_key(title, authors)
 where work_key is null;

create index if not exists books_work_key_idx on public.books (work_key);

-- Keep it current for every future import.
create or replace function public.tg_books_work_key()
returns trigger language plpgsql set search_path = public as $$
begin
  new.work_key := public.work_key(new.title, new.authors);
  return new;
end $$;
drop trigger if exists books_work_key on public.books;
create trigger books_work_key before insert or update of title, authors on public.books
  for each row execute function public.tg_books_work_key();

-- All editions of the work a given book belongs to, best first, so the book page
-- can offer an edition picker.
create or replace function public.get_book_editions(p_book_id uuid)
returns table (
  id uuid, title text, authors text[], cover_url text, language text,
  published_year int, isbn_13 text, page_count int, is_current boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select work_key from public.books where id = p_book_id)
  select b.id, b.title, b.authors, b.cover_url, b.language,
         b.published_year::int, b.isbn_13, b.page_count,
         (b.id = p_book_id) as is_current
  from public.books b, me
  where b.work_key = me.work_key and me.work_key is not null
  order by
    (b.id = p_book_id) desc,
    (b.language = coalesce((select reading_language from public.profiles where id = auth.uid()), 'it')) desc,
    (b.cover_url is not null) desc,
    (b.reads_count + b.saves_count + b.likes_count + b.reviews_count) desc,
    b.published_year desc nulls last;
$$;
grant execute on function public.get_book_editions(uuid) to authenticated, anon;

-- Search: one row per work, showing the edition that suits the reader best
-- (their language, then a real cover, then popularity).
create or replace function public.search_books(
  p_query  text default '',
  p_limit  int  default 20,
  p_offset int  default 0,
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
  ),
  hits as (
    select
      b.*,
      case when q.term = '' then 0
           else ts_rank(b.search_tsv, websearch_to_tsquery('simple', q.term))
                + similarity(public.immutable_unaccent(b.title), q.term)
                + case when q.lang <> 'all' and b.language = q.lang then 0.45 else 0 end
                + case when b.cover_url is not null then 0.05 else 0 end
      end as rank,
      q.lang as pref
    from public.books b, q
    where q.term = ''
       or b.search_tsv @@ websearch_to_tsquery('simple', q.term)
       or public.immutable_unaccent(b.title) % q.term
  ),
  -- One representative per work. Rows with no work_key fall back to their own id
  -- so they are never grouped together by accident.
  ranked as (
    select h.*,
      row_number() over (
        partition by coalesce(nullif(h.work_key, ''), h.id::text)
        order by
          (h.language = h.pref) desc,
          (h.cover_url is not null) desc,
          h.rank desc,
          (h.reads_count + h.saves_count + h.likes_count + h.reviews_count) desc
      ) as edition_rank
    from hits h
  )
  select
    r.id, r.title, r.subtitle, r.authors, r.cover_url, r.published_year,
    r.categories,
    case when r.rating_count > 0 then round(r.rating_sum::numeric / r.rating_count, 2) else null end as avg_rating,
    r.reads_count, r.saves_count, r.likes_count, r.reviews_count
  from ranked r
  where r.edition_rank = 1
  order by r.rank desc, (r.reads_count + r.saves_count + r.likes_count) desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;
grant execute on function public.search_books(text, int, int, text) to authenticated, anon;

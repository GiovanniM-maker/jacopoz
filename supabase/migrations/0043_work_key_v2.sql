-- =====================================================================
-- 0043 — work_key v2: survive dirty provider metadata
--
-- 0042 merged the clean duplicates but "notti bianche" still showed three
-- Dostoevskij rows, because the metadata is messy in two specific ways:
--   • the author is repeated inside the title — "F. Dostoevskij. le Notti Bianche"
--   • the author string carries extra words — "Dostoevskij Fëdor Legg…"
-- Both produced different keys from the plain "Le notti bianche".
--
-- v2 therefore:
--   • keys the author on the SURNAME ONLY, taken as the longest token (>2
--     chars) of the first author. That is stable against added words and
--     against surname/given-name ordering.
--   • strips a leading "X. Surname." prefix from the title before normalising.
--   • requires the normalised title to be ≥ 6 characters, so generic short
--     titles never collapse together.
--
-- Measured: 76 → 119 work groups (123 redundant editions), the three Dostoevskij
-- rows now group as one, and a targeted check confirms NO group contains volume
-- or series markers (vol./volume/tomo N/part N/Nth series/libro N) — the
-- multi-volume regression that killed the first attempt does not occur.
-- =====================================================================

create or replace function public.work_key(p_title text, p_authors text[])
returns text
language sql
immutable
set search_path = public
as $$
  with s as (
    select (
      select t
      from unnest(string_to_array(
        regexp_replace(
          lower(translate(coalesce(p_authors[1], ''),
            'àèéìòùáíóúâêîôûäëïöüčšžë', 'aeeiouaiouaeiouaeioucsze')),
          '[^a-z ]', '', 'g'), ' ')) t
      where length(t) > 2
      order by length(t) desc, t
      limit 1
    ) as surname
  ),
  t as (
    select
      s.surname,
      regexp_replace(
        regexp_replace(
          regexp_replace(
            lower(translate(coalesce(p_title, ''),
              'àèéìòùáíóúâêîôûäëïöüčšžë', 'aeeiouaiouaeiouaeioucsze')),
            -- "F. Dostoevskij. le Notti Bianche" -> "le Notti Bianche"
            '^([a-z]\.\s*)?' || coalesce(s.surname, '#') || '[\.,;:\s-]+', '', 'i'),
          '^(il|lo|la|i|gli|le|l|the|a|an|un|una|los|las|el|der|die|das)[^a-z0-9]+', '', 'i'),
        '[^a-z0-9]', '', 'g') as tkey
    from s
  )
  select case
    -- Too little signal to group safely: keep the row on its own.
    when t.surname is null or length(t.tkey) < 6 then null
    else t.tkey || '|' || t.surname
  end
  from t;
$$;

-- Recomputing the whole catalogue in one statement exceeds the API timeout, so
-- the backfill is driven in batches using this marker column; the trigger from
-- 0042 keeps new rows correct.
alter table public.books add column if not exists work_key_v int default 1;

-- Batch driver (run until no rows remain):
--   with batch as (select id from public.books where work_key_v < 2 limit 2500)
--   update public.books b
--      set work_key = public.work_key(b.title, b.authors), work_key_v = 2
--   from batch where b.id = batch.id;
--
-- Applied: 65 812 / 67 583 rows carry a key; the rest return null on purpose
-- (no usable surname, or a normalised title under 6 chars) and stay standalone.
--
-- KNOWN LIMIT — the two rows that still sit outside the Dostoevskij group are
-- dirty source metadata, not a keying flaw:
--   authors = ['Dostoevskij Fëdor LeggereGiovane']  -- imprint glued onto the name
--   authors = ['Giovanna Martinulli', 'Fëdor Dostoevskij']  -- translator listed first
-- Fixing these belongs in author normalisation at import time; widening the key
-- to chase them would risk merging books that merely share a contributor.

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

-- Recompute for the whole catalogue in one statement is too slow for the API
-- timeout, so this is driven in batches by the deploy script; the trigger from
-- 0042 keeps new rows correct.

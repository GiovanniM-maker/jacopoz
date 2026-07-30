-- =====================================================================
-- 0044 — work_key v3: ignore role credits when reading the author
--
-- Two things I set out to do here, and only one survived measurement.
--
-- 1. REJECTED — bulk author-name cleanup. The pattern I expected to be dirt (a
--    lowercase letter followed by an uppercase one) matches 1014 rows that are
--    almost all real names: MacIntyre, McKillop, McCall Smith, DeGraw, dePina.
--    Stripping it would have corrupted a thousand authors. Real pollution is
--    marginal — 35 rows naming a publisher, 90 containing digits — and even
--    those are often correct, since catalogues do credit "DK Publishing" as the
--    author. Bulk normalisation is the wrong tool; not doing it.
--
-- 2. REJECTED — keying on the "canonical" author, chosen as the listed author
--    whose surname appears in the most books. It fixed the case where a
--    translator is listed first, but introduced a worse failure: frequency
--    tracks *common* surnames, not authorship. "The Great Gatsby" credited to
--    ['F. Scott Fitzgerald', 'John Smith [Illustrator]'] keyed on `smith`,
--    because Smith is commoner in the catalogue than Fitzgerald — which would
--    let any same-titled book with a Smith credit merge into it. Reverted.
--
-- 3. KEPT — role credits no longer contribute a surname. Providers append them
--    to the name ("Smith, John [Illustrator]") and they leaked into the token
--    list: before this filter, "illustrator" (1394 books) and "translator" (441)
--    were the catalogue's most frequent "surnames". The key now reads the first
--    author that yields a real name, skipping pure role credits.
--
-- Net effect vs 0043: strictly safer, no new merges from common surnames, and
-- rows whose only "author" is a role credit stop grouping on that word.
-- =====================================================================

-- The longest meaningful token of a name, ignoring role/credit words.
-- Note: on a length tie this can pick the given name ("charles" for "Charles
-- Dickens"). Harmless for grouping — the rule is applied identically to every
-- edition, and being order-independent is exactly what reconciles
-- "Surname Firstname" with "Firstname Surname".
create or replace function public.surname_of(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select t
  from unnest(string_to_array(
    regexp_replace(
      lower(translate(coalesce(p_name, ''),
        'àèéìòùáíóúâêîôûäëïöüčšžë', 'aeeiouaiouaeiouaeioucsze')),
      '[^a-z ]', '', 'g'), ' ')) t
  where length(t) > 2
    and t not in (
      'illustrator','translator','editor','author','contributor','narrator',
      'foreword','introduction','preface','compiler','adapter','photographer',
      'illustratore','traduttore','traduzione','curatore','cura','autore',
      'prefazione','introduzione','edizioni','editore','publishing','publications',
      'press','books','libri','ebook','kindle','company','limited','inc','llc'
    )
  order by length(t) desc, t
  limit 1;
$$;

create or replace function public.work_key(p_title text, p_authors text[])
returns text
language sql
immutable
set search_path = public
as $$
  with pick as (
    -- First listed author that yields a real name (skips pure role credits).
    select public.surname_of(a) as sn
    from unnest(coalesce(p_authors, '{}'::text[])) with ordinality x(a, o)
    where public.surname_of(a) is not null
    order by o
    limit 1
  ),
  t as (
    select
      p.sn,
      regexp_replace(
        regexp_replace(
          regexp_replace(
            lower(translate(coalesce(p_title, ''),
              'àèéìòùáíóúâêîôûäëïöüčšžë', 'aeeiouaiouaeiouaeioucsze')),
            -- "F. Dostoevskij. le Notti Bianche" -> "le Notti Bianche"
            '^([a-z]\.\s*)?' || coalesce(p.sn, '#') || '[\.,;:\s-]+', '', 'i'),
          '^(il|lo|la|i|gli|le|l|the|a|an|un|una|los|las|el|der|die|das)[^a-z0-9]+', '', 'i'),
        '[^a-z0-9]', '', 'g') as tkey
    from pick p
  )
  select case
    -- Too little signal to group safely: keep the row standalone.
    when t.sn is null or length(t.tkey) < 6 then null
    else t.tkey || '|' || t.sn
  end
  from t;
$$;

-- The frequency machinery from the rejected experiment is not needed.
select cron.unschedule('refresh-surname-freq')
where exists (select 1 from cron.job where jobname = 'refresh-surname-freq');
drop table if exists public.author_surname_freq;

-- Backfill marker for the batch driver (a single 67k update exceeds the API
-- timeout). The trigger from 0042 keeps new rows correct.
alter table public.books add column if not exists work_key_v int default 1;

-- KNOWN LIMITS, both dirty source metadata rather than keying flaws:
--   authors = ['Dostoevskij Fëdor LeggereGiovane']       -- imprint glued onto the name
--   authors = ['Giovanna Martinulli', 'Fëdor Dostoevskij'] -- translator listed first
-- Chasing either would mean letting a non-primary credit decide the key, which
-- measurably causes worse false merges (see the Gatsby case above).

-- =====================================================================
-- 0001_extensions_and_helpers
-- Extensions and shared helper functions used across the schema.
-- =====================================================================

-- pgcrypto: gen_random_uuid(). pg_trgm/unaccent: fuzzy + accent-insensitive
-- search for the book catalog. All are available on Supabase by default.
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ---------------------------------------------------------------------
-- set_updated_at(): generic trigger to keep updated_at fresh on UPDATE.
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- immutable_unaccent(): unaccent is STABLE by default, which blocks its
-- use in generated columns / functional indexes. Wrap it as IMMUTABLE so
-- we can build search indexes on normalized text.
-- ---------------------------------------------------------------------
-- search_path pins the extensions schema (where Supabase installs unaccent)
-- while staying portable to setups that install it into public. The two-arg
-- unaccent(regdictionary, text) form is IMMUTABLE, so this can back both a
-- generated column and functional indexes.
create or replace function public.immutable_unaccent(text)
returns text
language sql
immutable
parallel safe
set search_path = extensions, public, pg_temp
as $$
  select unaccent('unaccent'::regdictionary, $1)
$$;

-- ---------------------------------------------------------------------
-- immutable_array_to_string(): array_to_string is only marked STABLE,
-- which blocks it inside generated columns. This wrapper is safe to mark
-- IMMUTABLE because our inputs are plain text[] with a constant delimiter.
-- ---------------------------------------------------------------------
create or replace function public.immutable_array_to_string(arr text[], sep text)
returns text
language sql
immutable
as $$
  select array_to_string(arr, sep)
$$;

-- ---------------------------------------------------------------------
-- slugify(): lower-case, accent-stripped, hyphenated slug. Used to keep
-- genre/category vocabulary consistent between ingestion and onboarding.
-- ---------------------------------------------------------------------
create or replace function public.slugify(txt text)
returns text
language sql
immutable
strict
as $$
  select trim(both '-' from
    regexp_replace(
      lower(public.immutable_unaccent(txt)),
      '[^a-z0-9]+', '-', 'g'
    )
  )
$$;

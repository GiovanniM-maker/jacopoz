-- =====================================================================
-- 0002_core_schema
-- Identity (profiles), the canonical book catalog, external-id mapping,
-- controlled genre vocabulary, and the per-user shelf (user_books).
-- =====================================================================

-- ---------------------------------------------------------------------
-- profiles: 1:1 with auth.users. We never expose auth.users to clients;
-- everything user-facing lives here. Populated by a trigger on signup.
-- ---------------------------------------------------------------------
create type public.user_role as enum ('user', 'moderator', 'admin');

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique
                 check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 60),
  bio          text check (char_length(bio) <= 300),
  avatar_url   text,
  role         public.user_role not null default 'user',
  -- Denormalized counters kept fresh by triggers (cheap reads for profiles).
  followers_count int not null default 0,
  following_count int not null default 0,
  books_read_count int not null default 0,
  -- Gamification scaffold: unused in the beta, present so we never migrate
  -- the hot table later. Points/level are computed by a future service.
  points       int not null default 0,
  onboarded_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index profiles_username_trgm_idx on public.profiles using gin (username gin_trgm_ops);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile when a new auth user is confirmed. Username is
-- derived from metadata or email local-part and de-duplicated with a suffix.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base_username text;
  final_username text;
  suffix int := 0;
begin
  base_username := public.slugify(
    coalesce(
      new.raw_user_meta_data->>'username',
      split_part(new.email, '@', 1),
      'reader'
    )
  );
  base_username := regexp_replace(base_username, '-', '_', 'g');
  base_username := left(coalesce(nullif(base_username, ''), 'reader'), 20);
  if char_length(base_username) < 3 then
    base_username := base_username || '_r';
  end if;

  final_username := base_username;
  while exists (select 1 from public.profiles where username = final_username) loop
    suffix := suffix + 1;
    final_username := left(base_username, 18) || '_' || suffix;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    final_username,
    coalesce(new.raw_user_meta_data->>'display_name', initcap(replace(final_username, '_', ' ')))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- genres: small controlled vocabulary used by onboarding + reco. Book
-- categories from external providers are normalized into these slugs.
-- ---------------------------------------------------------------------
create table public.genres (
  slug        text primary key,
  name        text not null,
  sort_order  int not null default 100
);

-- ---------------------------------------------------------------------
-- books: canonical catalog row. One row per work (deduped across
-- providers by ISBN-13, then by normalized title+author). External
-- provider IDs live in book_external_ids so a book can have several.
-- ---------------------------------------------------------------------
create table public.books (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  subtitle       text,
  authors        text[] not null default '{}',
  description     text,
  cover_url      text,             -- hotlinked from provider; cached later if needed
  published_year smallint,
  page_count     int,
  language       text,             -- ISO 639-1 where known
  isbn_13        text unique,
  isbn_10        text,
  -- Normalized genre slugs (subset of public.genres.slug). GIN-indexed for
  -- overlap queries in the recommendation engine.
  categories     text[] not null default '{}',
  -- Dedup key: slugified "title|first-author". Unique when ISBN is absent.
  dedup_key      text not null,
  -- Denormalized popularity signals maintained by triggers.
  saves_count    int not null default 0,
  reads_count    int not null default 0,
  likes_count    int not null default 0,
  reviews_count  int not null default 0,
  rating_sum     int not null default 0,   -- sum of user ratings
  rating_count   int not null default 0,   -- number of user ratings
  -- Full-text search document (title + authors + categories).
  search_tsv     tsvector generated always as (
    setweight(to_tsvector('simple'::regconfig, public.immutable_unaccent(coalesce(title, ''))), 'A') ||
    setweight(to_tsvector('simple'::regconfig, public.immutable_unaccent(public.immutable_array_to_string(authors, ' '))), 'B') ||
    setweight(to_tsvector('simple'::regconfig, public.immutable_unaccent(public.immutable_array_to_string(categories, ' '))), 'C')
  ) stored,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index books_dedup_key_idx on public.books (dedup_key);
create index books_search_tsv_idx on public.books using gin (search_tsv);
create index books_title_trgm_idx on public.books using gin (public.immutable_unaccent(title) gin_trgm_ops);
create index books_categories_idx on public.books using gin (categories);
create index books_authors_idx on public.books using gin (authors);
-- Popularity ordering for "trending" rows.
create index books_popularity_idx on public.books ((reads_count + saves_count + likes_count) desc);

create trigger books_set_updated_at
  before update on public.books
  for each row execute function public.set_updated_at();

-- Average rating as a read-side helper (avoids storing a float we must sync).
create or replace function public.book_avg_rating(b public.books)
returns numeric
language sql
stable
as $$
  select case when b.rating_count > 0
              then round(b.rating_sum::numeric / b.rating_count, 2)
              else null end
$$;

-- ---------------------------------------------------------------------
-- book_external_ids: provider -> external id -> our book. Lets ingestion
-- resolve "is this book already in the catalog?" cheaply and idempotently.
-- ---------------------------------------------------------------------
create type public.book_provider as enum ('google_books', 'open_library', 'manual');

create table public.book_external_ids (
  provider    public.book_provider not null,
  external_id text not null,
  book_id     uuid not null references public.books (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (provider, external_id)
);

create index book_external_ids_book_idx on public.book_external_ids (book_id);

-- ---------------------------------------------------------------------
-- user_books: the shelf. One row per (user, book) holding status,
-- like flag and personal rating. Absence of a row == no interaction.
--   status: null | want_to_read (saved) | reading | read
--   liked : "mi è piaciuto"
--   rating: 1..5 personal score (independent of a written review)
-- ---------------------------------------------------------------------
create type public.shelf_status as enum ('want_to_read', 'reading', 'read');

create table public.user_books (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  book_id     uuid not null references public.books (id) on delete cascade,
  status      public.shelf_status,
  liked       boolean not null default false,
  rating      smallint check (rating between 1 and 5),
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, book_id),
  -- A row must carry at least one signal; forbid empty ghost rows.
  constraint user_books_not_empty
    check (status is not null or liked = true or rating is not null)
);

create index user_books_user_status_idx on public.user_books (user_id, status);
create index user_books_book_idx on public.user_books (book_id);
create index user_books_liked_idx on public.user_books (book_id) where liked;

create trigger user_books_set_updated_at
  before update on public.user_books
  for each row execute function public.set_updated_at();

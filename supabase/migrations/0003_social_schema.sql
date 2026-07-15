-- =====================================================================
-- 0003_social_schema
-- Reviews, threaded comments, polymorphic likes, follows, and the
-- trigger machinery that keeps denormalized counters correct.
-- =====================================================================

-- Moderation lifecycle shared by user-generated content.
--   visible : normal
--   hidden  : soft-hidden by author or auto-filter (recoverable)
--   removed : removed by a moderator (kept for audit, never shown)
create type public.content_status as enum ('visible', 'hidden', 'removed');

-- ---------------------------------------------------------------------
-- reviews: one written review per (user, book). Rating here is the
-- review's score; it also syncs the user's shelf rating (see trigger).
-- ---------------------------------------------------------------------
create table public.reviews (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  book_id          uuid not null references public.books (id) on delete cascade,
  rating           smallint check (rating between 1 and 5),
  body             text not null check (char_length(body) between 1 and 5000),
  contains_spoilers boolean not null default false,
  status           public.content_status not null default 'visible',
  like_count       int not null default 0,
  comment_count    int not null default 0,
  -- Precomputed content-quality score in [0,1], refreshed on write. Kept
  -- as a column so the feed ranking never recomputes it per request.
  quality_score    numeric not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, book_id)
);

create index reviews_book_idx on public.reviews (book_id) where status = 'visible';
create index reviews_user_idx on public.reviews (user_id) where status = 'visible';
create index reviews_created_idx on public.reviews (created_at desc);

create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- comments: attached to a review. Single-level replies via
-- parent_comment_id (a reply's parent must itself be a top-level comment;
-- enforced in the API layer to keep the tree shallow and cheap to render).
-- ---------------------------------------------------------------------
create table public.comments (
  id                uuid primary key default gen_random_uuid(),
  review_id         uuid not null references public.reviews (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  parent_comment_id uuid references public.comments (id) on delete cascade,
  body              text not null check (char_length(body) between 1 and 2000),
  status            public.content_status not null default 'visible',
  like_count        int not null default 0,
  reply_count       int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index comments_review_idx on public.comments (review_id, created_at);
create index comments_parent_idx on public.comments (parent_comment_id, created_at);
create index comments_user_idx on public.comments (user_id);

create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- likes: one polymorphic table for review/comment likes. Cheaper than
-- two near-identical tables and keeps the toggle logic in one place.
-- ---------------------------------------------------------------------
create type public.likeable_type as enum ('review', 'comment');

create table public.likes (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  target_type public.likeable_type not null,
  target_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create index likes_target_idx on public.likes (target_type, target_id);

-- ---------------------------------------------------------------------
-- follows: directed follower -> following edges.
-- ---------------------------------------------------------------------
create table public.follows (
  follower_id  uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);

create index follows_following_idx on public.follows (following_id);

-- =====================================================================
-- Counter-maintenance triggers. All denormalized counts are derived
-- here so reads never aggregate. Every trigger is idempotent per row.
-- =====================================================================

-- --- review quality score ---------------------------------------------
-- Simple, transparent heuristic in [0,1]: rewards a written review of
-- reasonable length and having a rating. Intentionally not ML.
create or replace function public.compute_review_quality(body text, rating smallint)
returns numeric
language sql
immutable
as $$
  select least(1.0,
      0.15                                                        -- base for existing
    + least(char_length(coalesce(body, '')), 600)::numeric / 600 * 0.65  -- length up to 600 chars
    + case when rating is not null then 0.20 else 0 end          -- has a rating
  )
$$;

create or replace function public.reviews_before_write()
returns trigger
language plpgsql
as $$
begin
  new.quality_score := public.compute_review_quality(new.body, new.rating);
  return new;
end;
$$;

create trigger reviews_quality_bw
  before insert or update of body, rating on public.reviews
  for each row execute function public.reviews_before_write();

-- --- books.reviews_count ----------------------------------------------
-- Only the review COUNT lives here. A book's average rating is derived
-- from user_books.rating (the single source of truth for a user's score),
-- maintained by the user_books trigger below. reviews.rating is just a
-- display snapshot shown in the feed, so it must not double-count here.
create or replace function public.reviews_after_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.books
      set reviews_count = reviews_count + (new.status = 'visible')::int
      where id = new.book_id;
  elsif tg_op = 'DELETE' then
    update public.books
      set reviews_count = greatest(reviews_count - (old.status = 'visible')::int, 0)
      where id = old.book_id;
  elsif tg_op = 'UPDATE' then
    update public.books
      set reviews_count = greatest(reviews_count
            + (new.status = 'visible')::int - (old.status = 'visible')::int, 0)
      where id = new.book_id;
  end if;
  return null;
end;
$$;

create trigger reviews_counts_aic
  after insert or update or delete on public.reviews
  for each row execute function public.reviews_after_change();

-- --- comments: review.comment_count + parent.reply_count --------------
create or replace function public.comments_after_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.reviews set comment_count = comment_count + 1 where id = new.review_id;
    if new.parent_comment_id is not null then
      update public.comments set reply_count = reply_count + 1 where id = new.parent_comment_id;
    end if;
  elsif tg_op = 'DELETE' then
    update public.reviews set comment_count = greatest(comment_count - 1, 0) where id = old.review_id;
    if old.parent_comment_id is not null then
      update public.comments set reply_count = greatest(reply_count - 1, 0) where id = old.parent_comment_id;
    end if;
  end if;
  return null;
end;
$$;

create trigger comments_counts_aid
  after insert or delete on public.comments
  for each row execute function public.comments_after_change();

-- --- likes: fan out to reviews.like_count / comments.like_count -------
create or replace function public.likes_after_change()
returns trigger
language plpgsql
as $$
declare
  delta int;
  t public.likeable_type;
  tid uuid;
begin
  if tg_op = 'INSERT' then delta := 1; t := new.target_type; tid := new.target_id;
  else delta := -1; t := old.target_type; tid := old.target_id;
  end if;

  if t = 'review' then
    update public.reviews set like_count = greatest(like_count + delta, 0) where id = tid;
  elsif t = 'comment' then
    update public.comments set like_count = greatest(like_count + delta, 0) where id = tid;
  end if;
  return null;
end;
$$;

create trigger likes_counts_aid
  after insert or delete on public.likes
  for each row execute function public.likes_after_change();

-- --- follows: profile counters ---------------------------------------
create or replace function public.follows_after_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set following_count = following_count + 1 where id = new.follower_id;
    update public.profiles set followers_count = followers_count + 1 where id = new.following_id;
  elsif tg_op = 'DELETE' then
    update public.profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
    update public.profiles set followers_count = greatest(followers_count - 1, 0) where id = old.following_id;
  end if;
  return null;
end;
$$;

create trigger follows_counts_aid
  after insert or delete on public.follows
  for each row execute function public.follows_after_change();

-- --- user_books: book popularity + profile books_read_count ----------
create or replace function public.user_books_after_change()
returns trigger
language plpgsql
as $$
declare
  old_saved  bool := coalesce(old.status = 'want_to_read', false);
  new_saved  bool := coalesce(new.status = 'want_to_read', false);
  old_read   bool := coalesce(old.status = 'read', false);
  new_read   bool := coalesce(new.status = 'read', false);
  old_liked  bool := coalesce(old.liked, false);
  new_liked  bool := coalesce(new.liked, false);
begin
  if tg_op = 'INSERT' then
    update public.books set
      saves_count  = saves_count + new_saved::int,
      reads_count  = reads_count + new_read::int,
      likes_count  = likes_count + new_liked::int,
      rating_count = rating_count + (new.rating is not null)::int,
      rating_sum   = rating_sum + coalesce(new.rating, 0)
      where id = new.book_id;
    if new_read then
      update public.profiles set books_read_count = books_read_count + 1 where id = new.user_id;
    end if;
  elsif tg_op = 'DELETE' then
    update public.books set
      saves_count  = greatest(saves_count - old_saved::int, 0),
      reads_count  = greatest(reads_count - old_read::int, 0),
      likes_count  = greatest(likes_count - old_liked::int, 0),
      rating_count = greatest(rating_count - (old.rating is not null)::int, 0),
      rating_sum   = greatest(rating_sum - coalesce(old.rating, 0), 0)
      where id = old.book_id;
    if old_read then
      update public.profiles set books_read_count = greatest(books_read_count - 1, 0) where id = old.user_id;
    end if;
  elsif tg_op = 'UPDATE' then
    update public.books set
      saves_count  = greatest(saves_count + new_saved::int - old_saved::int, 0),
      reads_count  = greatest(reads_count + new_read::int - old_read::int, 0),
      likes_count  = greatest(likes_count + new_liked::int - old_liked::int, 0),
      rating_count = greatest(rating_count
        + (new.rating is not null)::int - (old.rating is not null)::int, 0),
      rating_sum   = greatest(rating_sum
        + coalesce(new.rating, 0) - coalesce(old.rating, 0), 0)
      where id = new.book_id;
    if new_read <> old_read then
      update public.profiles set
        books_read_count = greatest(books_read_count + new_read::int - old_read::int, 0)
        where id = new.user_id;
    end if;
  end if;
  return null;
end;
$$;

create trigger user_books_counts_aiud
  after insert or update or delete on public.user_books
  for each row execute function public.user_books_after_change();

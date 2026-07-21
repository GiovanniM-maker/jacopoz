-- =====================================================================
-- 0018_moderation
-- Minimum viable safety for go-live: users can report content and block
-- other readers. Three distinct reporters auto-hide a review/comment
-- (visible again only by manual action). Ranked feeds and book reviews
-- exclude authors the viewer has blocked.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Reports.
-- ---------------------------------------------------------------------
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('review', 'comment', 'user')),
  target_id   uuid not null,
  reason      text check (char_length(reason) <= 500),
  status      text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at  timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);

alter table public.reports enable row level security;

create policy reports_insert_own on public.reports
  for insert with check (reporter_id = auth.uid());
create policy reports_select_own on public.reports
  for select using (reporter_id = auth.uid());

-- Three distinct reporters hide the content automatically.
create or replace function public.moderate_on_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reporters int;
begin
  if new.target_type in ('review', 'comment') then
    select count(distinct reporter_id) into v_reporters
    from public.reports
    where target_type = new.target_type and target_id = new.target_id;

    if v_reporters >= 3 then
      if new.target_type = 'review' then
        update public.reviews set status = 'hidden' where id = new.target_id;
      else
        update public.comments set status = 'hidden' where id = new.target_id;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_moderate_on_report on public.reports;
create trigger trg_moderate_on_report
  after insert on public.reports
  for each row execute function public.moderate_on_report();

-- ---------------------------------------------------------------------
-- Blocks.
-- ---------------------------------------------------------------------
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.user_blocks enable row level security;

create policy blocks_all_own on public.user_blocks
  for all using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- ---------------------------------------------------------------------
-- Feed exclusion: authors you blocked disappear from ranked surfaces.
-- (Function bodies unchanged except for the block filter.)
-- ---------------------------------------------------------------------
create or replace function public.get_community_feed(
  p_limit  int default 20,
  p_offset int default 0
)
returns setof public.feed_item
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  c_half_life_hours constant numeric := 48;
begin
  return query
  with
  my_genres as (
    select genre_slug as g from public.user_genre_prefs where user_id = v_user
    union
    select unnest(b.categories)
    from public.user_books ub
    join public.books b on b.id = ub.book_id
    where ub.user_id = v_user and (ub.liked or ub.status = 'read')
  ),
  my_follows as (
    select following_id from public.follows where follower_id = v_user
  ),
  my_blocks as (
    select blocked_id from public.user_blocks where blocker_id = v_user
  ),
  max_eng as (
    select greatest(max(ln(1 + like_count + 1.5 * comment_count)), 1) as m
    from public.reviews where status = 'visible'
  )
  select
    r.id, r.book_id, b.title, b.cover_url, b.authors,
    p.id, p.username, p.display_name, p.avatar_url,
    r.rating, r.body, r.contains_spoilers,
    r.like_count, r.comment_count, r.created_at,
    exists (
      select 1 from public.likes l
      where l.user_id = v_user and l.target_type = 'review' and l.target_id = r.id
    ) as viewer_has_liked,
    round(
        0.30 * (ln(1 + r.like_count + 1.5 * r.comment_count) / (select m from max_eng))
      + 0.20 * r.quality_score
      + 0.20 * (
          case when r.user_id in (select following_id from my_follows) then 1.0
               when exists (select 1 from unnest(b.categories) c
                            where c in (select g from my_genres)) then 0.5
               else 0.0 end)
      + 0.30 * exp(- (extract(epoch from (now() - r.created_at)) / 3600.0) / c_half_life_hours)
    , 4) as score
  from public.reviews r
  join public.books b on b.id = r.book_id
  join public.profiles p on p.id = r.user_id
  where r.status = 'visible'
    and r.user_id <> v_user
    and r.user_id not in (select blocked_id from my_blocks)
  order by score desc, r.created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

create or replace function public.get_following_feed(
  p_limit  int default 20,
  p_offset int default 0
)
returns setof public.feed_item
language sql
stable
security definer
set search_path = public
as $$
  select
    r.id, r.book_id, b.title, b.cover_url, b.authors,
    p.id, p.username, p.display_name, p.avatar_url,
    r.rating, r.body, r.contains_spoilers,
    r.like_count, r.comment_count, r.created_at,
    exists (
      select 1 from public.likes l
      where l.user_id = auth.uid() and l.target_type = 'review' and l.target_id = r.id
    ) as viewer_has_liked,
    0::numeric as score
  from public.reviews r
  join public.books b on b.id = r.book_id
  join public.profiles p on p.id = r.user_id
  where r.status = 'visible'
    and r.user_id in (select following_id from public.follows where follower_id = auth.uid())
    and r.user_id not in (select blocked_id from public.user_blocks where blocker_id = auth.uid())
  order by r.created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

create or replace function public.get_book_reviews_ranked(
  p_book_id uuid,
  p_limit   int default 30,
  p_offset  int default 0
)
returns setof public.feed_item
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  c_half_life_hours constant numeric := 72;
begin
  return query
  with
  my_genres as (
    select genre_slug as g from public.user_genre_prefs where user_id = v_user
    union
    select unnest(b.categories)
    from public.user_books ub join public.books b on b.id = ub.book_id
    where ub.user_id = v_user and (ub.liked or ub.status = 'read')
  ),
  my_follows as (
    select following_id from public.follows where follower_id = v_user
  ),
  max_eng as (
    select greatest(max(ln(1 + like_count + 1.5 * comment_count)), 1) as m
    from public.reviews where book_id = p_book_id and status = 'visible'
  )
  select
    r.id, r.book_id, b.title, b.cover_url, b.authors,
    p.id, p.username, p.display_name, p.avatar_url,
    r.rating, r.body, r.contains_spoilers,
    r.like_count, r.comment_count, r.created_at,
    exists (
      select 1 from public.likes l
      where l.user_id = v_user and l.target_type = 'review' and l.target_id = r.id
    ) as viewer_has_liked,
    round(
        0.35 * (
          case when r.user_id in (select following_id from my_follows) then 1.0
               when exists (select 1 from public.user_books ub
                            join public.books rb on rb.id = ub.book_id
                            where ub.user_id = r.user_id and (ub.liked or ub.status = 'read')
                              and rb.categories && (select array_agg(g) from my_genres)) then 0.5
               else 0.0 end)
      + 0.25 * r.quality_score
      + 0.25 * (ln(1 + r.like_count + 1.5 * r.comment_count) / (select m from max_eng))
      + 0.15 * exp(- (extract(epoch from (now() - r.created_at)) / 3600.0) / c_half_life_hours)
    , 4) as score
  from public.reviews r
  join public.books b on b.id = r.book_id
  join public.profiles p on p.id = r.user_id
  where r.book_id = p_book_id
    and r.status = 'visible'
    and r.user_id not in (select blocked_id from public.user_blocks where blocker_id = v_user)
  order by score desc, r.created_at desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

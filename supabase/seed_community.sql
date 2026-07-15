-- =====================================================================
-- seed_community.sql — DEMO community content to kickstart the beta.
--
-- A social app that opens empty feels dead, so this seeds a handful of
-- demo readers with varied taste, their shelves, reviews, comments and
-- cross-likes. It gives the feed real ranked content and the collaborative
-- recommender real neighbours from day one.
--
-- Idempotent (safe to re-run). DEMO ONLY — remove or replace with real
-- invited users before a public launch:
--   delete from auth.users where email like '%@demo.jacopoz.app';
--
-- Apply after seed.sql:  psql "$SUPABASE_DB_URL" -f supabase/seed_community.sql
-- Depends on the curated books from seed.sql being present.
-- =====================================================================

-- --- Demo users (profiles are auto-created by the on_auth_user_created trigger)
insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000001-0000-0000-0000-000000000001', 'alina@demo.jacopoz.app',  '{"display_name":"Alina Fenn","username":"alina"}'),
  ('d0000002-0000-0000-0000-000000000002', 'marco@demo.jacopoz.app',  '{"display_name":"Marco Ruiz","username":"marco"}'),
  ('d0000003-0000-0000-0000-000000000003', 'sofia@demo.jacopoz.app',  '{"display_name":"Sofia Bianchi","username":"sofia"}'),
  ('d0000004-0000-0000-0000-000000000004', 'dan@demo.jacopoz.app',    '{"display_name":"Dan Okoro","username":"danok"}'),
  ('d0000005-0000-0000-0000-000000000005', 'priya@demo.jacopoz.app',  '{"display_name":"Priya Nair","username":"priya"}'),
  ('d0000006-0000-0000-0000-000000000006', 'luca@demo.jacopoz.app',   '{"display_name":"Luca Verdi","username":"lucav"}')
on conflict (id) do nothing;

-- --- Explicit taste (onboarding genre prefs) --------------------------
insert into public.user_genre_prefs (user_id, genre_slug) values
  ('d0000001-0000-0000-0000-000000000001', 'fantasy'),
  ('d0000001-0000-0000-0000-000000000001', 'scifi'),
  ('d0000002-0000-0000-0000-000000000002', 'thriller'),
  ('d0000002-0000-0000-0000-000000000002', 'mystery'),
  ('d0000003-0000-0000-0000-000000000003', 'romance'),
  ('d0000003-0000-0000-0000-000000000003', 'literary'),
  ('d0000004-0000-0000-0000-000000000004', 'business'),
  ('d0000004-0000-0000-0000-000000000004', 'psychology'),
  ('d0000004-0000-0000-0000-000000000004', 'self-help'),
  ('d0000005-0000-0000-0000-000000000005', 'scifi'),
  ('d0000005-0000-0000-0000-000000000005', 'fantasy'),
  ('d0000006-0000-0000-0000-000000000006', 'horror'),
  ('d0000006-0000-0000-0000-000000000006', 'thriller')
on conflict do nothing;

-- --- Shelves: read + liked + rated. Helper CTE resolves book ids by title.
with b as (select title, id from public.books)
insert into public.user_books (user_id, book_id, status, liked, rating)
select v.user_id::uuid, b.id, 'read', v.liked, v.rating
from (values
  -- Alina (fantasy/scifi)
  ('d0000001-0000-0000-0000-000000000001','The Name of the Wind',        true, 5),
  ('d0000001-0000-0000-0000-000000000001','Mistborn: The Final Empire',  true, 4),
  ('d0000001-0000-0000-0000-000000000001','Project Hail Mary',           true, 5),
  ('d0000001-0000-0000-0000-000000000001','The Way of Kings',            true, 5),
  -- Marco (thriller/mystery)
  ('d0000002-0000-0000-0000-000000000002','Gone Girl',                   true, 5),
  ('d0000002-0000-0000-0000-000000000002','The Silent Patient',          true, 4),
  ('d0000002-0000-0000-0000-000000000002','The Shining',                 true, 4),
  -- Sofia (romance/literary)
  ('d0000003-0000-0000-0000-000000000003','It Ends with Us',             true, 4),
  ('d0000003-0000-0000-0000-000000000003','Pride and Prejudice',         true, 5),
  ('d0000003-0000-0000-0000-000000000003','The Midnight Library',        true, 4),
  -- Dan (business/psychology/self-help)
  ('d0000004-0000-0000-0000-000000000004','Atomic Habits',               true, 5),
  ('d0000004-0000-0000-0000-000000000004','Zero to One',                 true, 4),
  ('d0000004-0000-0000-0000-000000000004','Thinking, Fast and Slow',     true, 5),
  ('d0000004-0000-0000-0000-000000000004','Sapiens',                     true, 4),
  -- Priya (scifi/fantasy) — overlaps Alina => taste-neighbour
  ('d0000005-0000-0000-0000-000000000005','Project Hail Mary',           true, 5),
  ('d0000005-0000-0000-0000-000000000005','Dune',                        true, 5),
  ('d0000005-0000-0000-0000-000000000005','The Three-Body Problem',      true, 4),
  ('d0000005-0000-0000-0000-000000000005','Mistborn: The Final Empire',  true, 5),
  -- Luca (horror/thriller) — overlaps Marco
  ('d0000006-0000-0000-0000-000000000006','The Shining',                 true, 5),
  ('d0000006-0000-0000-0000-000000000006','Gone Girl',                   true, 4),
  ('d0000006-0000-0000-0000-000000000006','1984',                        true, 5)
) as v(user_id, title, liked, rating)
join b on b.title = v.title
on conflict (user_id, book_id) do nothing;

-- --- Reviews (fixed ids so we can attach comments/likes) --------------
with b as (select title, id from public.books)
insert into public.reviews (id, user_id, book_id, rating, body, contains_spoilers)
select v.id::uuid, v.user_id::uuid, b.id, v.rating, v.body, false
from (values
  ('a0000001-0000-0000-0000-000000000001','d0000001-0000-0000-0000-000000000001','Project Hail Mary',5,
    'I did not expect to cry over a book about a lone astronaut and a spider-alien, yet here we are. Weir makes hard science feel like a page-turner. Rocky is the best fictional friendship I have read in years.'),
  ('a0000002-0000-0000-0000-000000000002','d0000001-0000-0000-0000-000000000001','The Way of Kings',5,
    'Enormous, but every page earns its place. The world-building is staggering and Kaladin''s arc gutted me. If you bounced off epic fantasy before, this is the one to try.'),
  ('a0000003-0000-0000-0000-000000000003','d0000002-0000-0000-0000-000000000002','Gone Girl',5,
    'The most fun I have had being manipulated by a narrator. That mid-book turn reframes everything. Flynn writes marriages like crime scenes.'),
  ('a0000004-0000-0000-0000-000000000004','d0000002-0000-0000-0000-000000000002','The Silent Patient',4,
    'A tight, twisty thriller. The ending is divisive but I bought it. Great one-sitting read on a rainy weekend.'),
  ('a0000005-0000-0000-0000-000000000005','d0000003-0000-0000-0000-000000000003','Pride and Prejudice',5,
    'Two hundred years on and still the sharpest romance ever written. Elizabeth Bennet remains an icon. Every re-read finds a new joke I missed.'),
  ('a0000006-0000-0000-0000-000000000006','d0000003-0000-0000-0000-000000000003','The Midnight Library',4,
    'A gentle, comforting read about the lives we didn''t live. A touch on the nose at times, but it landed for me when I needed it.'),
  ('a0000007-0000-0000-0000-000000000007','d0000004-0000-0000-0000-000000000004','Atomic Habits',5,
    'The rare productivity book that is actually actionable. "You do not rise to the level of your goals, you fall to the level of your systems." Changed how I structure my mornings.'),
  ('a0000008-0000-0000-0000-000000000008','d0000004-0000-0000-0000-000000000004','Thinking, Fast and Slow',5,
    'Dense but foundational. System 1 vs System 2 is a lens I now use constantly. Read it slowly, a chapter at a time.'),
  ('a0000009-0000-0000-0000-000000000009','d0000005-0000-0000-0000-000000000005','Dune',5,
    'A political-ecological epic disguised as a space adventure. The prose demands attention and rewards it tenfold. Still the benchmark for the genre.'),
  ('a0000010-0000-0000-0000-000000000010','d0000005-0000-0000-0000-000000000005','The Three-Body Problem',4,
    'Ideas so big they bend your brain. The characters are thin but the concepts are unforgettable. That countdown sequence lives in my head.'),
  ('a0000011-0000-0000-0000-000000000011','d0000006-0000-0000-0000-000000000006','The Shining',5,
    'King at his most claustrophobic. The Overlook is a character in itself. Forget the film — the book gets so much further inside Jack''s head.'),
  ('a0000012-0000-0000-0000-000000000012','d0000006-0000-0000-0000-000000000006','1984',5,
    'Reads less like fiction every year. Bleak, essential, unforgettable. The appendix on Newspeak is quietly the scariest part.')
) as v(id, user_id, title, rating, body)
join b on b.title = v.title
on conflict (id) do nothing;

-- --- Comments + one-level replies ------------------------------------
insert into public.comments (id, review_id, user_id, parent_comment_id, body) values
  ('c0000001-0000-0000-0000-000000000001','a0000001-0000-0000-0000-000000000001','d0000005-0000-0000-0000-000000000005', null, 'Rocky! I finished this on a flight and had to hide my face. Instant re-read.'),
  ('c0000002-0000-0000-0000-000000000002','a0000001-0000-0000-0000-000000000001','d0000001-0000-0000-0000-000000000001','c0000001-0000-0000-0000-000000000001', 'Right? "Question. Fistbump." destroyed me.'),
  ('c0000003-0000-0000-0000-000000000003','a0000003-0000-0000-0000-000000000003','d0000006-0000-0000-0000-000000000006', null, 'That turn is a masterclass. Never trusted a diary entry again.'),
  ('c0000004-0000-0000-0000-000000000004','a0000007-0000-0000-0000-000000000007','d0000005-0000-0000-0000-000000000005', null, 'The systems-over-goals framing finally made habits stick for me too.'),
  ('c0000005-0000-0000-0000-000000000005','a0000009-0000-0000-0000-000000000009','d0000001-0000-0000-0000-000000000001', null, 'Took me two tries to get into it, then I could not stop. Worth the patience.')
on conflict (id) do nothing;

-- --- Follows ----------------------------------------------------------
insert into public.follows (follower_id, following_id) values
  ('d0000001-0000-0000-0000-000000000001','d0000005-0000-0000-0000-000000000005'),
  ('d0000005-0000-0000-0000-000000000005','d0000001-0000-0000-0000-000000000001'),
  ('d0000002-0000-0000-0000-000000000002','d0000006-0000-0000-0000-000000000006'),
  ('d0000006-0000-0000-0000-000000000006','d0000002-0000-0000-0000-000000000002'),
  ('d0000003-0000-0000-0000-000000000003','d0000001-0000-0000-0000-000000000001'),
  ('d0000004-0000-0000-0000-000000000004','d0000005-0000-0000-0000-000000000005')
on conflict do nothing;

-- --- Cross-likes on reviews (drives feed engagement + quality signal) --
insert into public.likes (user_id, target_type, target_id) values
  ('d0000005-0000-0000-0000-000000000005','review','a0000001-0000-0000-0000-000000000001'),
  ('d0000003-0000-0000-0000-000000000003','review','a0000001-0000-0000-0000-000000000001'),
  ('d0000006-0000-0000-0000-000000000006','review','a0000001-0000-0000-0000-000000000001'),
  ('d0000005-0000-0000-0000-000000000005','review','a0000002-0000-0000-0000-000000000002'),
  ('d0000006-0000-0000-0000-000000000006','review','a0000003-0000-0000-0000-000000000003'),
  ('d0000002-0000-0000-0000-000000000002','review','a0000003-0000-0000-0000-000000000003'),
  ('d0000001-0000-0000-0000-000000000001','review','a0000007-0000-0000-0000-000000000007'),
  ('d0000005-0000-0000-0000-000000000005','review','a0000007-0000-0000-0000-000000000007'),
  ('d0000001-0000-0000-0000-000000000001','review','a0000009-0000-0000-0000-000000000009'),
  ('d0000004-0000-0000-0000-000000000004','review','a0000008-0000-0000-0000-000000000008'),
  ('d0000002-0000-0000-0000-000000000002','review','a0000011-0000-0000-0000-000000000011')
on conflict do nothing;

-- =====================================================================
-- seed.sql — reference data + a small curated catalog.
-- Safe to run on a fresh project: no dependency on auth users.
-- Run after migrations:  supabase db reset  (auto-applies this file)
-- or:  psql "$SUPABASE_DB_URL" -f supabase/seed.sql
-- =====================================================================

-- --- Genre vocabulary (drives onboarding + reco) ----------------------
insert into public.genres (slug, name, sort_order) values
  ('fantasy',      'Fantasy',            1),
  ('scifi',        'Science Fiction',    2),
  ('thriller',     'Thriller',           3),
  ('romance',      'Romance',            4),
  ('mystery',      'Mystery',            5),
  ('horror',       'Horror',             6),
  ('literary',     'Literary Fiction',   7),
  ('historical',   'Historical',         8),
  ('nonfiction',   'Non-fiction',        9),
  ('business',     'Business',          10),
  ('psychology',   'Psychology',        11),
  ('self-help',    'Self-help',         12),
  ('biography',    'Biography',         13),
  ('young-adult',  'Young Adult',       14),
  ('poetry',       'Poetry',            15)
on conflict (slug) do nothing;

-- --- Remote config / monetization switches ----------------------------
insert into public.app_config (key, value, description) values
  ('ads_enabled',          'false'::jsonb,           'Master switch for in-app ads. OFF for the private beta.'),
  ('amazon_affiliate_tag', '"jacopoz-20"'::jsonb,    'Amazon Associates tag appended to affiliate links.'),
  ('premium_enabled',      'false'::jsonb,           'Whether the Premium upsell is shown. OFF until features exist.'),
  ('min_app_version',      '"0.1.0"'::jsonb,         'Soft minimum client version for a forced-update nudge.')
on conflict (key) do nothing;

-- --- Achievement catalog (gamification is DESIGN-ONLY in the beta) -----
insert into public.achievements (code, kind, name, description, icon, xp_reward) values
  ('first_book',    'milestone', 'First Page Turned', 'Mark your first book as read.',            '📖', 50),
  ('bookworm_10',   'milestone', 'Bookworm',          'Read 10 books.',                            '🐛', 200),
  ('first_review',  'milestone', 'Critic',            'Write your first review.',                  '✍️', 50),
  ('liked_100',     'badge',     'Crowd Favourite',   'Receive 100 likes across your reviews.',    '⭐', 300),
  ('streak_7',      'badge',     'Consistent Reader', 'Maintain a 7-day activity streak.',         '🔥', 150),
  ('genre_explorer','achievement','Genre Explorer',   'Read books from 5 different genres.',        '🧭', 250)
on conflict (code) do nothing;

-- --- Curated catalog for cold-start (dashboard is never empty) --------
-- Covers hotlinked from Open Library by ISBN. External ids let ingestion
-- recognise these books instead of creating duplicates.
insert into public.books (title, authors, categories, isbn_13, dedup_key, published_year, cover_url) values
  ('The Name of the Wind', array['Patrick Rothfuss'],    array['fantasy'],            '9780756404741', public.slugify('The Name of the Wind') || '|' || public.slugify('Patrick Rothfuss'), 2007, 'https://covers.openlibrary.org/b/isbn/9780756404741-L.jpg'),
  ('Mistborn: The Final Empire', array['Brandon Sanderson'], array['fantasy'],        '9780765311788', public.slugify('Mistborn The Final Empire') || '|' || public.slugify('Brandon Sanderson'), 2006, 'https://covers.openlibrary.org/b/isbn/9780765311788-L.jpg'),
  ('The Way of Kings',    array['Brandon Sanderson'],     array['fantasy'],            '9780765326355', public.slugify('The Way of Kings') || '|' || public.slugify('Brandon Sanderson'), 2010, 'https://covers.openlibrary.org/b/isbn/9780765326355-L.jpg'),
  ('Dune',                array['Frank Herbert'],         array['scifi'],              '9780441172719', public.slugify('Dune') || '|' || public.slugify('Frank Herbert'), 1965, 'https://covers.openlibrary.org/b/isbn/9780441172719-L.jpg'),
  ('Project Hail Mary',   array['Andy Weir'],             array['scifi'],              '9780593135204', public.slugify('Project Hail Mary') || '|' || public.slugify('Andy Weir'), 2021, 'https://covers.openlibrary.org/b/isbn/9780593135204-L.jpg'),
  ('The Three-Body Problem', array['Cixin Liu'],          array['scifi'],              '9780765382030', public.slugify('The Three-Body Problem') || '|' || public.slugify('Cixin Liu'), 2008, 'https://covers.openlibrary.org/b/isbn/9780765382030-L.jpg'),
  ('Gone Girl',           array['Gillian Flynn'],         array['thriller','mystery'], '9780307588371', public.slugify('Gone Girl') || '|' || public.slugify('Gillian Flynn'), 2012, 'https://covers.openlibrary.org/b/isbn/9780307588371-L.jpg'),
  ('The Silent Patient',  array['Alex Michaelides'],      array['thriller'],           '9781250301697', public.slugify('The Silent Patient') || '|' || public.slugify('Alex Michaelides'), 2019, 'https://covers.openlibrary.org/b/isbn/9781250301697-L.jpg'),
  ('It Ends with Us',     array['Colleen Hoover'],        array['romance'],            '9781501110368', public.slugify('It Ends with Us') || '|' || public.slugify('Colleen Hoover'), 2016, 'https://covers.openlibrary.org/b/isbn/9781501110368-L.jpg'),
  ('Pride and Prejudice', array['Jane Austen'],           array['romance','literary'], '9780141439518', public.slugify('Pride and Prejudice') || '|' || public.slugify('Jane Austen'), 1813, 'https://covers.openlibrary.org/b/isbn/9780141439518-L.jpg'),
  ('1984',                array['George Orwell'],         array['scifi','literary'],   '9780451524935', public.slugify('1984') || '|' || public.slugify('George Orwell'), 1949, 'https://covers.openlibrary.org/b/isbn/9780451524935-L.jpg'),
  ('The Midnight Library',array['Matt Haig'],             array['literary'],           '9780525559474', public.slugify('The Midnight Library') || '|' || public.slugify('Matt Haig'), 2020, 'https://covers.openlibrary.org/b/isbn/9780525559474-L.jpg'),
  ('Sapiens',             array['Yuval Noah Harari'],     array['nonfiction','historical'], '9780099590088', public.slugify('Sapiens') || '|' || public.slugify('Yuval Noah Harari'), 2011, 'https://covers.openlibrary.org/b/isbn/9780099590088-L.jpg'),
  ('Zero to One',         array['Peter Thiel'],           array['business'],           '9780804139298', public.slugify('Zero to One') || '|' || public.slugify('Peter Thiel'), 2014, 'https://covers.openlibrary.org/b/isbn/9780804139298-L.jpg'),
  ('Atomic Habits',       array['James Clear'],           array['self-help','psychology'], '9780735211292', public.slugify('Atomic Habits') || '|' || public.slugify('James Clear'), 2018, 'https://covers.openlibrary.org/b/isbn/9780735211292-L.jpg'),
  ('Thinking, Fast and Slow', array['Daniel Kahneman'],   array['psychology','nonfiction'], '9780374533557', public.slugify('Thinking Fast and Slow') || '|' || public.slugify('Daniel Kahneman'), 2011, 'https://covers.openlibrary.org/b/isbn/9780374533557-L.jpg'),
  ('Educated',            array['Tara Westover'],         array['biography','nonfiction'], '9780399590504', public.slugify('Educated') || '|' || public.slugify('Tara Westover'), 2018, 'https://covers.openlibrary.org/b/isbn/9780399590504-L.jpg'),
  ('The Hobbit',          array['J.R.R. Tolkien'],        array['fantasy','young-adult'], '9780547928227', public.slugify('The Hobbit') || '|' || public.slugify('J.R.R. Tolkien'), 1937, 'https://covers.openlibrary.org/b/isbn/9780547928227-L.jpg'),
  ('The Hunger Games',    array['Suzanne Collins'],       array['young-adult','scifi'], '9780439023481', public.slugify('The Hunger Games') || '|' || public.slugify('Suzanne Collins'), 2008, 'https://covers.openlibrary.org/b/isbn/9780439023481-L.jpg'),
  ('The Shining',         array['Stephen King'],          array['horror','thriller'],  '9780307743657', public.slugify('The Shining') || '|' || public.slugify('Stephen King'), 1977, 'https://covers.openlibrary.org/b/isbn/9780307743657-L.jpg')
on conflict (isbn_13) do nothing;

-- Map the seeded books to their Open Library ISBN ids for idempotent ingestion.
insert into public.book_external_ids (provider, external_id, book_id)
select 'open_library', 'ISBN:' || b.isbn_13, b.id
from public.books b
where b.isbn_13 is not null
on conflict do nothing;

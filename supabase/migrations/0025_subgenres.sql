-- =====================================================================
-- 0025 — subgenres
--
-- Finer taste labels under the top-level genres, for a richer onboarding
-- taste-picker and browsable sections. These are *declared-interest* tags:
-- the fine-grained profiling itself is done by the nightly embedding
-- clusters (internal_build_taste_clusters), which need no labels. When a
-- user picks a subgenre we also credit its parent, so genre-affinity in the
-- recommender (which matches book.categories = parent slugs) still fires.
-- =====================================================================

alter table public.genres
  add column if not exists parent_slug text references public.genres(slug);

-- Subgenres: (slug, name, parent, sort). sort_order continues past the 15
-- top-level genres so ordering stays stable.
insert into public.genres (slug, name, parent_slug, sort_order) values
  -- Romance
  ('dark-romance',        'Dark Romance',            'romance',     101),
  ('romantasy',           'Romantasy',               'romance',     102),
  ('contemporary-romance','Romance contemporaneo',   'romance',     103),
  ('historical-romance',  'Romance storico',         'romance',     104),
  ('romantic-suspense',   'Romantic suspense',       'romance',     105),
  ('new-adult',           'New Adult',               'romance',     106),
  -- Fantasy
  ('epic-fantasy',        'Fantasy epico',           'fantasy',     111),
  ('dark-fantasy',        'Dark fantasy',            'fantasy',     112),
  ('urban-fantasy',       'Urban fantasy',           'fantasy',     113),
  ('cozy-fantasy',        'Cozy fantasy',            'fantasy',     114),
  ('grimdark',            'Grimdark',                'fantasy',     115),
  -- Sci-fi
  ('space-opera',         'Space opera',             'scifi',       121),
  ('hard-scifi',          'Hard sci-fi',             'scifi',       122),
  ('dystopian',           'Distopico',               'scifi',       123),
  ('cyberpunk',           'Cyberpunk',               'scifi',       124),
  -- Thriller
  ('psychological-thriller','Thriller psicologico',  'thriller',    131),
  ('spy-thriller',        'Spy story',               'thriller',    132),
  ('domestic-thriller',   'Domestic thriller',       'thriller',    133),
  -- Mystery
  ('cozy-mystery',        'Cozy mystery',            'mystery',     141),
  ('detective',           'Detective',               'mystery',     142),
  ('noir',                'Noir',                    'mystery',     143),
  ('true-crime',          'True crime',              'mystery',     144),
  -- Horror
  ('gothic',              'Gotico',                  'horror',      151),
  ('supernatural-horror', 'Soprannaturale',          'horror',      152),
  ('cosmic-horror',       'Horror cosmico',          'horror',      153),
  -- Young Adult
  ('ya-fantasy',          'YA fantasy',              'young-adult', 161),
  ('ya-romance',          'YA romance',              'young-adult', 162),
  ('ya-dystopian',        'YA distopico',            'young-adult', 163),
  -- Literary
  ('magical-realism',     'Realismo magico',         'literary',    171),
  ('classics',            'Classici',                'literary',    172),
  -- Historical
  ('historical-fiction',  'Narrativa storica',       'historical',  181),
  ('war-fiction',         'Narrativa di guerra',     'historical',  182),
  -- Non-fiction
  ('memoir',              'Memoir',                  'nonfiction',  191),
  ('popular-science',     'Divulgazione scientifica','nonfiction',  192),
  ('history-nf',          'Storia',                  'nonfiction',  193),
  ('philosophy',          'Filosofia',               'nonfiction',  194)
on conflict (slug) do nothing;

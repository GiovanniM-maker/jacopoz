-- =====================================================================
-- 0039 — indexes for the new home sections
--
-- The editorial rows in get_home_sections (acclaimed / hidden gems / short
-- reads / free classics) filtered on columns with no supporting index, so each
-- one scanned the 67k-row catalogue: a seed whose rows were all editorial took
-- ~2.1 s. These make each of those rows an index range scan.
-- =====================================================================

-- "Acclamati" / "Piccole gemme": both filter on the external rating pair.
create index if not exists books_external_rating_idx
  on public.books (external_rating desc, external_ratings_count desc)
  where external_rating is not null and cover_url is not null;

-- "Brevi: finiscili in una sera".
create index if not exists books_page_count_idx
  on public.books (page_count)
  where page_count is not null and cover_url is not null;

-- "Classici da leggere gratis": only a small slice of the catalogue qualifies.
create index if not exists books_free_read_idx
  on public.books (id)
  where free_read_url is not null and cover_url is not null;

analyze public.books;

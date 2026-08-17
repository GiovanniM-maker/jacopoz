-- =====================================================================
-- 0059 — chiudere l'accesso al testo dell'editore
--
-- 0058 aveva separato i due campi ma lasciato `source_blurb_internal`
-- leggibile: il bundle allora in produzione faceva ancora `select("*")` e una
-- revoca lo avrebbe rotto all'istante. Verificato che il bundle online ora
-- chiede colonne esplicite e non nomina mai quel campo, la porta si chiude.
--
-- Postgres non ha una "revoca su una colonna": si revoca il SELECT sulla
-- tabella e lo si riconcede colonna per colonna. Da qui in poi `select *` su
-- books fallisce per anon e authenticated — che è il punto: se qualcuno lo
-- reintroduce se ne accorge subito invece di esporre il campo in silenzio.
-- =====================================================================

revoke select on public.books from anon, authenticated;

grant select (
  id, title, subtitle, authors, synopsis, synopsis_source, cover_url,
  published_year, page_count, language, isbn_13, isbn_10, categories,
  saves_count, reads_count, likes_count, reviews_count,
  rating_sum, rating_count, external_rating, external_ratings_count,
  gutenberg_id, free_read_url, work_key, cluster_id, dedup_key,
  created_at, updated_at
) on public.books to anon, authenticated;

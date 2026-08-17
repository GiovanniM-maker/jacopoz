-- =====================================================================
-- 0040 — buy link: never trust the stored ISBN or language
--
-- 0038 used the ISBN when books.language = 'it'. Inspecting the data shows that
-- flag is unreliable — "Ensel Und Krete" (German) and "La Bataille de Kadesh"
-- (French) are both stored as language 'it', with their foreign ISBNs. Trusting
-- it reproduced exactly the reported bug: "Compra su Amazon" landing on a
-- German/Catalan edition for an Italian reader.
--
-- A stored ISBN identifies *one specific edition*, usually whichever the import
-- provider happened to return. A title+author search on the Italian storefront
-- lets Amazon pick the edition on sale locally — the Italian one when it exists,
-- the original otherwise. That is the behaviour a reader expects, so the buy
-- link now always searches by title + author.
-- =====================================================================

create or replace function public.amazon_buy_url(p_book_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'https://www.amazon.it/s?k='
         -- Strip edition parentheticals ("(Gli Adelphi)", "(Oscar Mondadori)")
         -- so the query is the work, not one publisher's packaging.
         || public.urlencode(
              btrim(regexp_replace(b.title, '\([^)]*\)', ' ', 'g')) || ' '
              || coalesce(b.authors[1], ''))
         || '&i=stripbooks&tag='
         || coalesce((select value #>> '{}' from public.app_config where key = 'amazon_affiliate_tag'),
                     'jacopoz-21')
  from public.books b where b.id = p_book_id;
$$;
grant execute on function public.amazon_buy_url(uuid) to authenticated, anon;

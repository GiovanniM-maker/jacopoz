-- =====================================================================
-- 0080 — La classifica: l'indice che mancava, e la cache del serbatoio
--
-- `get_trending_seeded` costruisce un serbatoio dei primi 120 libri per
-- popolarità e poi lo mescola con un seme di sessione. Misurato:
--
--   serbatoio (primi 120)   67,6 – 1.631 ms   scansione sequenziale di 65.090 righe
--
-- **C'era già un indice che sembrava servirlo e non lo serviva:**
--
--   books_popularity_idx  →  ((reads_count + saves_count + likes_count) desc)
--   la classifica ordina  →   (reads_count + saves_count + likes_count + reviews_count)
--
-- Manca `reviews_count`. Un'espressione diversa dall'indice non è
-- un'espressione simile: è un indice che non verrà usato. È lo stesso difetto
-- di `books_free_read_idx` in 0075, che aveva zero utilizzi da mesi.
--
-- --------------------------------------------------------------------
-- Perché qui la cache ha senso e sulle altre due letture no
-- --------------------------------------------------------------------
-- Il seme cambia a ogni sessione, quindi mettere in cache il **risultato** non
-- servirebbe a niente: nessuna due chiamate chiedono lo stesso ordine. Ma il
-- seme mescola soltanto — la parte costosa, la selezione dei 120, è identica
-- per tutti e cambia solo quando cambiano i contatori.
--
-- Quindi si mette in cache il serbatoio e si mescola fuori. È la stessa regola
-- che in 0079 tiene `is_current` fuori dalla scheda dell'opera: **in cache va
-- ciò che è uguale per tutti, il resto si calcola a ogni chiamata.**
-- =====================================================================

-- L'espressione è copiata carattere per carattere da `get_trending_seeded`.
create index if not exists books_trending_pop_idx on public.books
  (((reads_count + saves_count + likes_count + reviews_count)) desc, created_at desc)
  where cover_url is not null;

-- --------------------------------------------------------------------
-- `catalog:trending` — TTL 1 ora, il serbatoio non l'ordine
-- --------------------------------------------------------------------
create or replace function public.get_trending_cached(p_limit int default 20, p_seed int default 0)
returns setof public.book_card
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  c_key   constant text := 'catalog:trending';
  v_cache jsonb;
begin
  begin
    v_cache := public.internal_cache_get(c_key);
  exception when others then
    v_cache := null;   -- store illeggibile: si va per la strada lunga
  end;

  if v_cache is null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'title', p.title, 'subtitle', p.subtitle, 'authors', p.authors,
             'cover_url', p.cover_url, 'published_year', p.published_year,
             'categories', p.categories, 'avg_rating', public.book_avg_rating(p),
             'reads_count', p.reads_count, 'saves_count', p.saves_count,
             'likes_count', p.likes_count, 'reviews_count', p.reviews_count,
             'pop', p.reads_count + p.saves_count + p.likes_count + p.reviews_count
           ) order by (p.reads_count + p.saves_count + p.likes_count + p.reviews_count) desc,
             p.created_at desc), '[]'::jsonb)
      into v_cache
    from (
      select b.* from public.books b
      where b.cover_url is not null
      order by (b.reads_count + b.saves_count + b.likes_count + b.reviews_count) desc,
               b.created_at desc
      limit 120
    ) p;

    begin
      perform public.internal_cache_put(c_key, v_cache, interval '1 hour');
    exception when others then
      null;
    end;
  end if;

  -- Il mescolamento sta fuori dalla cache, ed è la ragione per cui la cache
  -- funziona: la parte condivisa è il serbatoio, non l'ordine.
  return query
  select (r ->> 'id')::uuid, r ->> 'title', r ->> 'subtitle',
         array(select jsonb_array_elements_text(r -> 'authors')),
         r ->> 'cover_url', (r ->> 'published_year')::smallint,
         array(select jsonb_array_elements_text(r -> 'categories')),
         (r ->> 'avg_rating')::numeric,
         (r ->> 'reads_count')::int, (r ->> 'saves_count')::int,
         (r ->> 'likes_count')::int, (r ->> 'reviews_count')::int
  from jsonb_array_elements(v_cache) as r
  order by (r ->> 'pop')::numeric
           * (0.6 + (abs(hashtext((r ->> 'id') || ':' || p_seed::text)) % 1000)::numeric / 1000 * 0.8) desc
  limit greatest(p_limit, 0);
end;
$$;
revoke execute on function public.get_trending_cached(int, int) from public;
grant execute on function public.get_trending_cached(int, int) to anon, authenticated;

-- I contatori cambiano il serbatoio. Non si invalida a ogni like — sarebbe
-- invalidare continuamente — ma alla scadenza dell'ora: una classifica vecchia
-- di cinquanta minuti è ancora una classifica, e questo è il caso in cui un TTL
-- vale più di un'invalidazione precisa.

analyze public.books;

-- =====================================================================
-- 0083 — «Ancora <autore>»: non sorteggiare una riga che non si può riempire
--
-- Conseguenza misurata di 0082, non un ripensamento: dopo il filtro italiano
-- circa metà delle righe d'autore non arriva a quattro carte, e il client mostra
-- una sezione solo da quattro in su. Contati gli autori amati da ogni lettore e
-- quanti di loro hanno almeno quattro libri italiani con copertina:
--
--   lettore    autori amati   riempivano prima   riempiono in italiano
--   d978d856         7               3                    2
--   192096a2         7               4                    2
--   da937caf         6               5                    3
--   04c8117f         4               4                    1
--   c8e334d3         4               4                    1
--   3d98e9fc         3               3                    0
--
-- Su cinque semi, «Ancora <autore>» veniva estratta 8 volte per da937caf e
-- mostrata 5, estratta 8 per c8e334d3 e mostrata 3, estratta 2 per 3d98e9fc e
-- mostrata **zero**.
--
-- È lo stesso difetto di «Acclamati dai lettori di tutto il mondo», rimossa in
-- 0082: le cinque sezioni si estraggono a sorte da un serbatoio, quindi una
-- specifica che non può rendere niente **non è una riga vuota, è una riga in
-- meno**. Lì la specifica era morta per tutti; qui è morta per l'autore
-- sbagliato, e la soluzione è la stessa — non metterla nel sorteggio.
--
-- Nessun altro genere di sezione ha bisogno della guardia: su cinque semi e
-- quattro lettori, `similar_to_book` e `theme` sono state mostrate ogni volta
-- che sono state estratte (18 su 18 e 24 su 24). Le 19 categorie che hanno libri
-- italiani con copertina ne hanno tutte almeno quattro.
-- =====================================================================

-- Carica la libreria di pgvector prima del DDL: senza, la clausola
-- `SET hnsw.*` di questa funzione è un segnaposto e impostarla richiede il
-- superutente. Vedi 0082.
select ('[1,0,0]'::extensions.vector(3) <=> '[0,1,0]'::extensions.vector(3)) as carica_pgvector;

CREATE OR REPLACE FUNCTION public.get_home_sections(p_seed integer DEFAULT 0, p_max_sections integer DEFAULT 5, p_per_section integer DEFAULT 12)
 RETURNS TABLE(section_key text, section_title text, section_rank integer, id uuid, title text, subtitle text, authors text[], cover_url text, published_year integer, categories text[], avg_rating numeric, reads_count integer, saves_count integer, likes_count integer, reviews_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET "hnsw.ef_search" TO '100'
 SET "hnsw.iterative_scan" TO 'relaxed_order'
AS $function$
declare
  v_user  uuid := auth.uid();
  v_specs jsonb := '[]'::jsonb;
  v_spec  jsonb;
  v_rank  int := 0;
  v_emb   text;
begin
  -- Anchor books: things the reader demonstrably liked, rotated by the seed so
  -- "Perché hai letto…" isn't always about the same book.
  v_specs := v_specs || (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'similar_to_book', 'ref', b.id::text,
             'title', 'Perché hai letto ' || b.title)), '[]'::jsonb)
    from (
      select b.id, b.title
      from public.books b
      join public.user_books ub on ub.book_id = b.id
      where ub.user_id = v_user
        and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
        and b.embedding is not null
      order by abs(hashtext(b.id::text || ':' || p_seed::text))
      limit 3
    ) b
  );

  -- Gli autori che ha votato alto, ma solo quelli che possono riempire una riga.
  v_specs := v_specs || (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'more_by_author', 'ref', a.author,
             'title', 'Ancora ' || a.author)), '[]'::jsonb)
    from (
      select a.author
      from (
        select distinct unnest(b.authors) as author
        from public.books b
        join public.user_books ub on ub.book_id = b.id
        where ub.user_id = v_user
          and (ub.liked or coalesce(ub.rating, 0) >= 4)
      ) a
      where a.author is not null
        -- Almeno quattro libri mostrabili, che è la soglia sotto la quale il
        -- client non rende la sezione. Il conteggio si ferma a quattro: sapere
        -- che sono «almeno quattro» basta, contarli tutti per un autore
        -- prolifico no.
        and (
          select count(*) from (
            select 1 from public.books b2
            where a.author = any(b2.authors)
              and b2.cover_url is not null
              and b2.language = 'it'
              and not exists (select 1 from public.user_books ub2
                              where ub2.user_id = v_user and ub2.book_id = b2.id)
            limit 4
          ) x
        ) >= 4
      -- Il filtro sta **dentro** il limit, non dopo: filtrare sei autori già
      -- estratti lascerebbe fuori un settimo che invece riempirebbe la riga.
      order by 1
      limit 6
    ) a
    where a.author is not null
  );

  -- Dominant themes from the reader's taste clusters / explicit prefs.
  v_specs := v_specs || (
    select coalesce(jsonb_agg(jsonb_build_object(
             'kind', 'theme', 'ref', t.cat,
             'title', 'Il tuo filone: ' || public.genre_label(t.cat))), '[]'::jsonb)
    from (
      select unnest(b.categories) as cat
      from public.books b
      join public.user_taste_clusters tc on tc.medoid_book_id = b.id
      where tc.user_id = v_user
      union
      select genre_slug from public.user_genre_prefs where user_id = v_user
      limit 8
    ) t
    where t.cat is not null
  );

  -- Editorial angles that stay meaningful without personal history.
  v_specs := v_specs || jsonb_build_array(
    jsonb_build_object('kind', 'free_classics', 'ref', '', 'title', 'Classici da leggere gratis, ora'),
    jsonb_build_object('kind', 'short_reads',   'ref', '', 'title', 'Brevi: finiscili in una sera'),
    jsonb_build_object('kind', 'hidden_gems',   'ref', '', 'title', 'Piccole gemme da scoprire')
  );

  -- Pick and order the rows for this seed.
  for v_spec in
    select s.spec from (
      select value as spec
      from jsonb_array_elements(v_specs) value
      order by abs(hashtext((value->>'kind') || (value->>'ref') || ':' || p_seed::text))
      limit greatest(p_max_sections, 1)
    ) s
  loop
    v_rank := v_rank + 1;

    if v_spec->>'kind' = 'similar_to_book' then
      -- Semantic neighbours of the anchor book. The vector is inlined so the
      -- HNSW index is used (a bound parameter falls back to a seq scan).
      select b.embedding::extensions.halfvec(512)::text into v_emb
        from public.books b where b.id = (v_spec->>'ref')::uuid;
      if v_emb is null then continue; end if;
      return query execute format($q$
        select %L::text, %L::text, %s::int,
               b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
               case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
               b.reads_count, b.saves_count, b.likes_count, b.reviews_count
        from public.books b
        where b.embedding is not null and b.cover_url is not null and b.language = 'it'
          and b.id <> %L::uuid
          and not exists (select 1 from public.user_books ub where ub.user_id = %L::uuid and ub.book_id = b.id)
        order by (b.embedding::extensions.halfvec(512)) <=> %L::extensions.halfvec(512)
        limit %s
      $q$, v_spec->>'kind' || ':' || (v_spec->>'ref'), v_spec->>'title', v_rank,
           v_spec->>'ref', v_user, v_emb, p_per_section);

    elsif v_spec->>'kind' = 'more_by_author' then
      return query
      select (v_spec->>'kind') || ':' || (v_spec->>'ref'), v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where (v_spec->>'ref') = any(b.authors)
        and b.cover_url is not null and b.language = 'it'
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      order by (b.reads_count + b.likes_count + b.saves_count) desc, b.published_year desc nulls last
      limit p_per_section;

    elsif v_spec->>'kind' = 'theme' then
      return query
      select (v_spec->>'kind') || ':' || (v_spec->>'ref'), v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where (v_spec->>'ref') = any(b.categories)
        and b.cover_url is not null and b.language = 'it'
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      -- L'ordinamento era `external_rating * ln(2 + conteggio)`, zero per il
      -- 99,65% del catalogo: una chiave che pareggia sempre non è una chiave, e
      -- il seme moltiplicava zero, quindi la riga non ruotava affatto. Prima i
      -- libri che hanno una sinossi da leggere sotto la copertina (345 in
      -- italiano), poi la rotazione col seme.
      order by (b.synopsis is not null) desc,
               (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000) desc
      limit p_per_section;

    elsif v_spec->>'kind' = 'free_classics' then
      return query
      select v_spec->>'kind', v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where b.free_read_url is not null and b.cover_url is not null and b.language = 'it'
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      -- L'ordinamento era `external_rating * ln(2 + conteggio)`, zero per il
      -- 99,65% del catalogo: una chiave che pareggia sempre non è una chiave, e
      -- il seme moltiplicava zero, quindi la riga non ruotava affatto. Prima i
      -- libri che hanno una sinossi da leggere sotto la copertina (345 in
      -- italiano), poi la rotazione col seme.
      order by (b.synopsis is not null) desc,
               (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000) desc
      limit p_per_section;

    elsif v_spec->>'kind' = 'short_reads' then
      return query
      select v_spec->>'kind', v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where b.page_count between 40 and 200 and b.cover_url is not null and b.language = 'it'
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      -- L'ordinamento era `external_rating * ln(2 + conteggio)`, zero per il
      -- 99,65% del catalogo: una chiave che pareggia sempre non è una chiave, e
      -- il seme moltiplicava zero, quindi la riga non ruotava affatto. Prima i
      -- libri che hanno una sinossi da leggere sotto la copertina (345 in
      -- italiano), poi la rotazione col seme.
      order by (b.synopsis is not null) desc,
               (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000) desc
      limit p_per_section;

    else -- hidden_gems: well rated but not yet mainstream
      return query
      select v_spec->>'kind', v_spec->>'title', v_rank,
             b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
             case when b.rating_count > 0 then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
             b.reads_count, b.saves_count, b.likes_count, b.reviews_count
      from public.books b
      where coalesce(b.external_rating, 0) >= 4.0
        and coalesce(b.external_ratings_count, 0) between 20 and 400
        and b.cover_url is not null and b.language = 'it'
        and not exists (select 1 from public.user_books ub where ub.user_id = v_user and ub.book_id = b.id)
      order by (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000) desc
      limit p_per_section;
    end if;
  end loop;
end;
$function$;

revoke execute on function public.get_home_sections(int, int, int) from public;
grant execute on function public.get_home_sections(int, int, int) to authenticated;

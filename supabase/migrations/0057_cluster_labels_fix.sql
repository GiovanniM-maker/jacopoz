-- =====================================================================
-- 0057 — nomi dei filoni: due correzioni, una tecnica e una di merito
--
-- 1. BUG. `unnest(p.authors) a` crea un alias di tabella `a` con dentro una
--    colonna `a`, e nella sottoquery correlata `where g.a = a` il riferimento
--    era ambiguo: risolveva sulla tabella interna invece che sulla colonna
--    esterna, la condizione diventava vera per tante righe e la funzione moriva
--    con "more than one row returned by a subquery". Alias espliciti.
--
-- 2. MERITO. Il genere veniva scelto come "il più frequente nel filone", e con
--    68.000 libri incasellati in 19 categorie il più frequente è quasi sempre
--    `literary`: duecento filoni chiamati tutti "Narrativa". Vale per i generi
--    la stessa regola già usata per gli autori — conta quanto una categoria
--    pesa **qui rispetto al catalogo**, non quanto pesa in assoluto. Un filone
--    di fantascienza contiene una frazione di `scifi` molto più alta della
--    media, e quello è il suo nome; che dentro ci sia anche del `literary` non
--    lo rende narrativa generica.
-- =====================================================================

create or replace function public.internal_label_clusters()
returns int
language sql
volatile
security definer
set search_path = public, extensions
as $$
  with libri as (
    select b.cluster_id as cl, b.categories, b.authors
    from public.books b where b.cluster_id is not null
  ),
  totale as (select count(*)::numeric n from libri),
  -- Quanto pesa ogni categoria nel catalogo intero.
  cat_globale as (
    select c.cat, count(*)::numeric / (select n from totale) as quota
    from libri l, unnest(l.categories) as c(cat)
    group by c.cat
  ),
  cat_filone as (
    select l.cl, c.cat, count(*)::numeric as k
    from libri l, unnest(l.categories) as c(cat)
    group by l.cl, c.cat
  ),
  dim as (select cl, count(*)::numeric n from libri group by cl),
  genere as (
    select cf.cl, (array_agg(cf.cat order by cf.k / d.n / g.quota desc, cf.k desc))[1] as top
    from cat_filone cf
    join dim d on d.cl = cf.cl
    join cat_globale g on g.cat = cf.cat
    -- Sotto un decimo del filone è rumore, non un tratto distintivo.
    where cf.k / d.n >= 0.10
    group by cf.cl
  ),
  aut_globale as (
    select au.nome, count(*)::numeric k
    from libri l, unnest(l.authors) as au(nome)
    group by au.nome
  ),
  autore as (
    select z.cl, (array_agg(z.nome order by z.score desc, z.k desc))[1] as top
    from (
      select l.cl, au.nome, count(*)::numeric k,
             count(*)::numeric / greatest(ag.k, 1) as score
      from libri l, unnest(l.authors) as au(nome)
      join aut_globale ag on ag.nome = au.nome
      group by l.cl, au.nome, ag.k
      having count(*) >= 4
    ) z
    -- Almeno metà dei libri di quell'autore stanno qui: altrimenti non è
    -- l'autore *di questo filone*, è solo un autore prolifico.
    where z.score >= 0.5
    group by z.cl
  ),
  etichette as (
    select c.id,
           trim(coalesce(public.genre_label(g.top), 'Da scoprire')
                || coalesce(' · attorno a ' || au.top, '')) as label
    from public.book_clusters c
    left join genere g on g.cl = c.id
    left join autore au on au.cl = c.id
  ),
  scritte as (
    update public.book_clusters c set label = e.label
    from etichette e where e.id = c.id
    returning 1
  )
  select count(*)::int from scritte;
$$;
revoke execute on function public.internal_label_clusters() from public, anon, authenticated;

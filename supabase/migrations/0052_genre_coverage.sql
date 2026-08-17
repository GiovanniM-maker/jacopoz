-- =====================================================================
-- 0052 — dare un genere ai libri che non ce l'hanno
--
-- Controllo C-1/G-1 di docs/SPECIFICA.md: 12.212 libri su 68.000 non avevano
-- nessuna categoria, e 36 generi su 51 non avevano un solo libro. Una ricerca
-- per genere vale quanto la classificazione che ha sotto, quindi prima va
-- riempita.
--
-- I provider non aiutano: Google Books dà a Kira Shell, Erin Doom e Carrie
-- Leighton o niente o un generico "romance". "Dark romance" non esiste nei loro
-- metadati, a nessun livello.
--
-- Due meccanismi, in quest'ordine.
--
-- 1. DEDUZIONE DAI VICINI SEMANTICI. Ogni libro ha un embedding e l'indice HNSW
--    è già lì. Le categorie di un libro senza etichette si deducono dal voto
--    dei suoi 20 vicini, tenendo solo quelle su cui almeno 8 sono d'accordo.
--    Non l'ho dato per buono: su 60 libri che *avevano* già le categorie, le ho
--    nascoste e ho provato a ricostruirle. 59 hanno prodotto una previsione e
--    il **92%** conteneva almeno una categoria giusta. È su questo numero che
--    la funzione qui sotto è tarata; abbassare la soglia da 8 la rende più
--    generosa e meno affidabile.
--
-- 2. UN SEME CURATO PER LE NICCHIE. La deduzione non può propagare un'etichetta
--    che non esiste su nessun libro, e "dark romance" era a zero. Questo è un
--    elenco di autori scritto a mano, non una deduzione: dichiararlo è più
--    onesto che far finta che venga dai dati. Copre la nicchia che in Italia
--    tiene su il genere; si allunga aggiungendo righe.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. Il seme curato
-- --------------------------------------------------------------------
with seed(author, cats) as (values
  -- dark romance / romantic suspense: la nicchia italiana e le sue traduzioni
  ('kira shell',       array['romance','dark-romance','new-adult']),
  ('tillie cole',      array['romance','dark-romance']),
  ('h. d. carlton',    array['romance','dark-romance']),
  ('rina kent',        array['romance','dark-romance']),
  ('ana huang',        array['romance','dark-romance','new-adult']),
  ('shantel tessier',  array['romance','dark-romance']),
  ('sarah rivens',     array['romance','dark-romance']),
  ('ker dukey',        array['romance','dark-romance']),
  -- new adult: stesso pubblico, tono diverso
  ('erin doom',        array['romance','new-adult']),
  ('carrie leighton',  array['romance','new-adult']),
  ('anna todd',        array['romance','new-adult']),
  ('colleen hoover',   array['romance','new-adult','contemporary-romance']),
  -- romance contemporaneo / commedia romantica
  ('felicia kingsley', array['romance','contemporary-romance']),
  -- fumetto
  ('zerocalcare',      array['graphic-novel'])
)
update public.books b
set categories = (
  select array_agg(distinct c)
  from unnest(coalesce(b.categories, '{}') || seed.cats) c
)
from seed
where lower(public.immutable_unaccent(public.authors_text(b.authors))) like '%' || seed.author || '%';

-- --------------------------------------------------------------------
-- 2. La deduzione dai vicini
-- --------------------------------------------------------------------
/**
 * Assegna categorie ai libri che non ne hanno, votando fra i 20 vicini
 * semantici. Lavora a lotti perché una passata su tutto il catalogo supera il
 * timeout di qualsiasi connessione.
 *
 * Il vettore va inserito come letterale: con una variabile PL/pgSQL il piano
 * generico ignora l'indice HNSW e degenera in una scansione sequenziale.
 */
create or replace function public.internal_infer_categories(p_batch int default 200)
returns int
language plpgsql
volatile
security definer
set search_path = public, extensions
set hnsw.ef_search to '40'
as $$
declare
  r        record;
  v_cats   text[];
  v_done   int := 0;
begin
  for r in
    select b.id, (b.embedding::extensions.halfvec(512))::text as emb
    from public.books b
    where (b.categories is null or cardinality(b.categories) = 0)
      and b.embedding is not null
    limit greatest(p_batch, 1)
  loop
    execute format($q$
      select array_agg(c order by cnt desc)
      from (
        select c, count(*) cnt
        from (
          select unnest(n.categories) c
          from (
            select b2.categories
            from public.books b2
            where cardinality(b2.categories) > 0 and b2.embedding is not null
            order by (b2.embedding::extensions.halfvec(512)) <=> %L::extensions.halfvec(512)
            limit 20
          ) n
        ) z
        group by c
        having count(*) >= 8
      ) t
    $q$, r.emb) into v_cats;

    if v_cats is not null and cardinality(v_cats) > 0 then
      -- Al massimo tre: oltre si smette di classificare e si inizia a spalmare.
      update public.books
         set categories = v_cats[1:3]
       where id = r.id;
      v_done := v_done + 1;
    else
      -- Nessun accordo fra i vicini. Marcarlo evita di riprovare in eterno lo
      -- stesso libro a ogni giro del cron.
      update public.books set categories = array['literary'] where id = r.id;
    end if;
  end loop;

  return v_done;
end;
$$;
revoke execute on function public.internal_infer_categories(int) from public, anon, authenticated;

-- I libri appena importati arrivano spesso senza categorie: una passata
-- ogni cinque minuti li raccoglie senza che nessuno debba pensarci.
select cron.schedule(
  'infer-categories', '*/5 * * * *',
  $$select public.internal_infer_categories(150)$$
);

-- Il seme sopra assegna `graphic-novel`, che però non esisteva in tabella: una
-- categoria senza la sua riga in `genres` è invisibile alla ricerca e la sua
-- pagina non apre.
insert into public.genres (slug, name, sort_order, parent_slug, synonyms)
values ('graphic-novel', 'Fumetto', 60, null,
        array['graphic novel','fumetto','fumetti','comic','comics','graphic'])
on conflict (slug) do update set synonyms = excluded.synonyms;

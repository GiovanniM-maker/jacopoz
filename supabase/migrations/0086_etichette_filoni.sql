-- =====================================================================
-- 0086 — I nomi dei filoni: chi è una persona, che lingua si legge, e
--        nessun filone che si chiami come un altro
--
-- Tre difetti misurati sui 200 filoni attuali. Il quarto — «Dick [Illustrator]
-- Francis» — non è qui perché è stato corretto alla fonte in 0085: le etichette
-- lo ereditano senza dover sapere niente.
--
-- --------------------------------------------------------------------
-- 1. Diciannove filoni con cinque nomi
-- --------------------------------------------------------------------
--   Storico    ×6      1.023 libri
--   Narrativa  ×5        731
--   Fantasy    ×3        394
--   Biografie  ×3        614
--   Poesia     ×2        454
--
-- Sono i filoni in cui nessun autore supera la soglia di distintività, quindi
-- l'etichetta si riduce al genere. Sei righe della Home chiamate tutte «Storico»
-- non sono sei filoni: sono un filone rotto in sei, ed è esattamente il difetto
-- che 0055 esisteva per risolvere.
--
-- Cosa distingue davvero quei sei, guardati uno per uno: **l'epoca**. Anno medio
-- 1897, 1923, 1931, 1960, 1961, 1969. Le categorie secondarie no — quattro su
-- sei hanno `literary` al secondo posto. Quindi si disambigua con il decennio,
-- che è un tratto vero, e solo come ultima spiaggia con un numero.
--
-- --------------------------------------------------------------------
-- 2. «Economia · attorno a Germany»
-- --------------------------------------------------------------------
-- La lista dei nomi che non sono persone è **contata**, non immaginata. Contati
-- tutti i nomi di autore di una sola parola latina presenti su almeno quattro
-- libri — cioè l'intera popolazione che può vincere lo slot:
--
--   non sono persone   Various 302 · Anonymous 285 · Unknown 74 · Brazil 10 ·
--                      lePetitLitteraire 9 · Mojang 6 · Portugal 6 ·
--                      Germany 5 · Italy 5 · Collectif 5
--
--   sono persone       Plato · Ouida · Molière · Aristotle · Voltaire · Pansy ·
--                      Duchess · Euripides · Xenophon · Ovid · Hergé ·
--                      Zerocalcare · Aesop · Plutarch · Sophocles · Homer ·
--                      Aristophanes · Aeschylus · Horace · Stendhal · Virgil ·
--                      Cicero · Saki · Neera · Confucius · CLAMP · Avi · Hesiod
--
-- Nessuna regola strutturale separa le due colonne: «Germany» e «Virgil» hanno
-- la stessa forma, e «Duchess», «Pansy» e «Saki» sono pseudonimi di persone
-- vere. Una regola sul numero di parole avrebbe cancellato Omero insieme al
-- Brasile. Quindi: un elenco, dichiarato per quello che è, più le parole che
-- segnalano un ente («Society», «Institute», «Inc.»).
--
-- I nomi di paese ci sono perché i cataloghi bibliografici accreditano i governi
-- come autori collettivi delle loro pubblicazioni.
--
-- --------------------------------------------------------------------
-- 3. La lingua non si legge nel nome
-- --------------------------------------------------------------------
--   filoni a maggioranza italiana         11
--   misti                                 32
--   sotto il 10% di italiano             157
--   senza nemmeno un libro italiano       31
--
-- Da quando la Home mostra solo italiano (0082), un filone che è inglese al 97%
-- non può riempire una riga — e il suo nome non lo dice. Si scrive: «Storico ·
-- in inglese». L'italiano **non** si marca: in un'app italiana è il caso
-- normale, e scriverlo sarebbe rumore su ogni riga.
-- =====================================================================

/**
 * Vero se il nome designa una persona che può dare il nome a un filone.
 *
 * Non è un giudizio sull'identità: «Various» e «Germany» sono attribuzioni
 * legittime in un record bibliografico. È un giudizio sull'**etichetta**:
 * «Saggistica · attorno a Germany» non dice niente a un lettore.
 */
create or replace function public.autore_e_persona(p_nome text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_nome is not null
     and btrim(p_nome) <> ''
     -- Non-attribuzioni e nomi collettivi, contati sul catalogo.
     and lower(btrim(p_nome)) not in (
           'various', 'anonymous', 'anonimo', 'unknown', 'sconosciuto',
           'collectif', 'aa. vv.', 'aa.vv.', 'autori vari', 'mojang',
           'lepetitlitteraire',
           -- Paesi: i cataloghi accreditano i governi come autori collettivi.
           'germany', 'italy', 'brazil', 'portugal', 'france', 'spain',
           'england', 'great britain', 'united states', 'canada', 'australia',
           'russia', 'china', 'japan', 'india', 'mexico', 'argentina',
           'netherlands', 'belgium', 'sweden', 'norway', 'denmark', 'poland',
           'austria', 'switzerland', 'greece', 'turkey', 'egypt', 'ireland',
           'scotland'
         )
     -- Enti. `\m` è il confine di parola di Postgres: senza, «Institute»
     -- prenderebbe anche un cognome che contiene quelle lettere.
     and p_nome !~* ('\m(society|institute|association|committee|department|'
                     || 'university|ministry|bureau|commission|council|museum|'
                     || 'library|congress|corporation|foundation|academy|'
                     || 'services|staff)\M')
     and p_nome !~* '\m(inc|ltd|llc|gmbh|s\.p\.a|s\.r\.l)\M\.?';
$$;
grant execute on function public.autore_e_persona(text) to authenticated, anon;

/** Il nome italiano di una lingua, per l'etichetta di un filone. */
create or replace function public.lingua_in_italiano(p_codice text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(coalesce(p_codice, ''))
    when 'en' then 'inglese'      when 'fr' then 'francese'
    when 'es' then 'spagnolo'     when 'de' then 'tedesco'
    when 'pt' then 'portoghese'   when 'ja' then 'giapponese'
    when 'ru' then 'russo'        when 'la' then 'latino'
    when 'nl' then 'olandese'     when 'zh' then 'cinese'
    when 'ko' then 'coreano'      when 'sv' then 'svedese'
    when 'da' then 'danese'       when 'no' then 'norvegese'
    when 'fi' then 'finlandese'   when 'pl' then 'polacco'
    when 'el' then 'greco'        when 'ar' then 'arabo'
    when 'ca' then 'catalano'     when 'hu' then 'ungherese'
    when 'cs' then 'ceco'         when 'tr' then 'turco'
    when 'it' then 'italiano'
    else null   -- una lingua che non sappiamo nominare non si nomina
  end;
$$;
grant execute on function public.lingua_in_italiano(text) to authenticated, anon;

-- --------------------------------------------------------------------
-- L'etichettatura
-- --------------------------------------------------------------------
-- --------------------------------------------------------------------
-- Il guasto che questa funzione ha causato, e il limite che lo impedisce
-- --------------------------------------------------------------------
-- La prima stesura chiamava `autore_e_persona` **dentro** il `where`, cioè su
-- tutte le 91.399 occorrenze di autore prima del raggruppamento: tre espressioni
-- regolari e un elenco di quaranta stringhe per riga. Su un'istanza Micro da
-- 1 GB ha occupato la base dati al punto che **non accettava più connessioni**:
-- per qualche minuto il sito ha continuato a rispondere 200 (è una pagina
-- statica) e ogni lettura di dati è andata in timeout. Verificato dall'esterno,
-- non dedotto: `/rest/v1/books?select=id&limit=1` non rispondeva.
--
-- Due correzioni, e servono entrambe:
--
-- 1. Il filtro sulle persone si applica **dopo** il raggruppamento, dove le
--    righe sono le coppie (filone, autore) con almeno quattro libri invece di
--    novantunmila nomi.
--
-- 2. `statement_timeout` sulla funzione. Questo è il punto che conta: la prima
--    correzione rende la funzione veloce *oggi*, con questo catalogo. La seconda
--    fa in modo che il giorno in cui tornerà lenta — un catalogo più grande, un
--    piano diverso — muoia da sola invece di portarsi via i lettori. Il ruolo
--    `postgres` non ha un limite di istruzione: è comodo per le migrazioni ed è
--    esattamente ciò che ha permesso il guasto.
--
--    Trenta secondi, non novanta. La prima stesura ne metteva novanta, e sarebbe
--    stata una protezione finta: l'istanza ha smesso di accettare connessioni
--    **molto prima** di novanta secondi. Un limite che scatta dopo che il danno
--    è fatto non è un limite, è un commento. Se questa funzione non chiude in
--    trenta secondi su questo catalogo, non deve girare in primo piano affatto.
--
-- E la parte della diagnosi che avevo sbagliato la prima volta: la query pesante
-- non era sola. 0085 ha rimesso in coda 2.229 libri per il ricalcolo
-- dell'embedding, e ogni libro riembeddato è un inserimento nell'indice HNSW da
-- 91 MB. L'aggregazione è arrivata **sopra** a quell'onda. Nessuna delle due,
-- probabilmente, avrebbe fatto danno da sola; insieme, su 1 GB di RAM con un set
-- di lavoro da 270 MB, hanno fermato tutto. La regola che ne esce: le due cose
-- non si fanno lo stesso giorno, e la seconda si aspetta che la prima sia finita.
create or replace function public.internal_label_clusters()
returns int
language plpgsql
volatile
security definer
set search_path = public, extensions
set statement_timeout = '30s'
set lock_timeout = '10s'
as $$
declare
  v_scritte int;
begin
  create temp table _et on commit drop as
  with libri as (
    select b.cluster_id as cl, b.categories, b.authors, b.language, b.published_year
    from public.books b where b.cluster_id is not null
  ),
  totale as (select count(*)::numeric n from libri),
  dim as (select cl, count(*)::numeric n from libri group by cl),

  -- Il genere: quanto una categoria pesa **qui** rispetto al catalogo (0057).
  -- Il più frequente in assoluto sarebbe `literary` per quasi tutti.
  cat_globale as (
    select c.cat, count(*)::numeric / (select n from totale) as quota
    from libri l, unnest(l.categories) as c(cat) group by c.cat
  ),
  cat_filone as (
    select l.cl, c.cat, count(*)::numeric as k
    from libri l, unnest(l.categories) as c(cat) group by l.cl, c.cat
  ),
  genere as (
    select cf.cl, (array_agg(cf.cat order by cf.k / d.n / g.quota desc, cf.k desc))[1] as top
    from cat_filone cf
    join dim d on d.cl = cf.cl
    join cat_globale g on g.cat = cf.cat
    where cf.k / d.n >= 0.10
    group by cf.cl
  ),

  -- L'autore sovra-rappresentato, e solo se è una persona.
  aut_globale as (
    select au.nome, count(*)::numeric k from libri l, unnest(l.authors) as au(nome)
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
    -- `autore_e_persona` sta **qui** e non nel `where` di sopra: là girerebbe
    -- su 91.399 nomi, qui su qualche migliaio di coppie (filone, autore). È la
    -- differenza fra una funzione che finisce e una che occupa l'istanza.
    where z.score >= 0.5 and public.autore_e_persona(z.nome)
    group by z.cl
  ),

  -- La lingua dominante, se davvero domina.
  lingua as (
    select cl,
           (array_agg(lang order by k desc))[1] as top,
           max(k) / sum(k) as quota
    from (select l.cl, l.language as lang, count(*)::numeric k
          from libri l where l.language is not null group by l.cl, l.language) z
    group by cl
  ),

  -- Il decennio, per distinguere i filoni che il genere non distingue.
  epoca as (
    select cl, (avg(published_year)::int / 10) * 10 as decennio
    from libri where published_year is not null group by cl
  ),

  base as (
    select c.id, c.size,
           coalesce(public.genre_label(g.top), 'Da scoprire')
           || case
                when li.top is not null and li.top <> 'it' and li.quota >= 0.80
                     and public.lingua_in_italiano(li.top) is not null
                then ' · in ' || public.lingua_in_italiano(li.top)
                else ''
              end
           || coalesce(' · attorno a ' || au.top, '') as etichetta,
           e.decennio
    from public.book_clusters c
    left join genere  g  on g.cl  = c.id
    left join autore  au on au.cl = c.id
    left join lingua  li on li.cl = c.id
    left join epoca   e  on e.cl  = c.id
  ),

  -- Unicità. Chi non ha omonimi tiene il nome; chi ce l'ha prende il decennio,
  -- **tutti** quanti sono — lasciare il nome nudo al più grande e qualificare
  -- solo gli altri direbbe che il primo è «lo Storico» e gli altri dei casi
  -- particolari, che non è vero.
  con_omonimi as (
    select b.*, count(*) over (partition by b.etichetta) as omonimi from base b
  ),
  qualificate as (
    select id, size,
           case when omonimi > 1 and decennio is not null
                then etichetta || ' · anni ' || decennio
                else etichetta end as etichetta
    from con_omonimi
  ),
  -- Se il decennio non basta (o manca), un numero. Non è bello, ma due filoni
  -- con lo stesso nome sono peggio: il lettore non può sapere che sono diversi.
  finali as (
    select id,
           case when count(*) over (partition by etichetta) > 1
                then etichetta || ' · '
                     || row_number() over (partition by etichetta order by size desc, id)
                else etichetta end as etichetta
    from qualificate
  )
  select id, etichetta from finali;

  update public.book_clusters c set label = e.etichetta
  from _et e where e.id = c.id;
  get diagnostics v_scritte = row_count;

  return v_scritte;
end;
$$;
revoke execute on function public.internal_label_clusters() from public, anon, authenticated;

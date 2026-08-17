-- =====================================================================
-- 0076 — Via la superficie Amazon, e stop alle recensioni esterne
--
-- --------------------------------------------------------------------
-- Amazon: le funzioni si eliminano perché non hanno mai potuto rendere niente
-- --------------------------------------------------------------------
-- Il tag di affiliazione memorizzato in `app_config` è `jacopoz-20`: è un tag
-- del programma **.com**. I link che le due funzioni generavano puntano invece
-- su **amazon.it**. Un tag di un altro marketplace viene semplicemente
-- ignorato, quindi nessuna conversione è mai stata attribuita a noi — non è che
-- ha reso poco, non ha reso *nulla*, in nessun momento. Un pulsante che manda
-- il lettore fuori dall'app senza guadagnarci sopra è tutto costo e nessun
-- ricavo, e per questo qui la rimozione è completa: client e database.
--
-- Le firme verificate su questo database prima di scrivere i `drop`:
--
--   proname                | pg_get_function_identity_arguments
--   -----------------------+-----------------------------------
--   amazon_affiliate_url   | p_isbn text
--   amazon_buy_url         | p_book_id uuid
--
-- La verifica non è pedanteria: `drop function if exists` con una firma
-- sbagliata riesce senza fare niente, ed è il modo peggiore di fallire perché
-- la migrazione risulta applicata e la funzione è ancora là.
--
-- Le migrazioni che le avevano create e corrette (0009, 0038, 0040) restano
-- dove sono: la storia non si riscrive.
--
-- --------------------------------------------------------------------
-- Recensioni esterne: si smette di scriverne, i dati restano
-- --------------------------------------------------------------------
-- In catalogo ci sono **238 recensioni prese da fonti esterne** contro **14
-- recensioni scritte da lettori veri**. Una scheda libro in cui la voce di
-- fuori copre diciassette volte quella di dentro tradisce la promessa
-- dell'app. Il blocco «Dalla critica» è già via dal client.
--
-- Qui si chiude il rubinetto: nel ramo `wiki_summary` di
-- `internal_enrich_ingest` sparisce l'`insert into public.external_reviews`.
-- **Resta** l'`update` che scrive `books.source_blurb_internal` dallo stesso
-- extract di Wikipedia: quello è materiale grezzo per le sinossi, non è
-- contenuto che un lettore vede, e serve.
--
-- La tabella `public.external_reviews` e le sue 238 righe **non si toccano**.
-- Portano attribuzione e licenza (CC BY-SA 4.0), cancellarle è irreversibile e
-- non fa risparmiare niente: una tabella che nessuno legge non costa nulla, e
-- se un giorno «Dalla critica» tornerà è già lì. Restano anche il vincolo di
-- unicità `(book_id, source)` e le policy: servono solo se si riapre.
--
-- Il corpo della funzione qui sotto è quello ripreso da `pg_get_functiondef`
-- meno quell'unico `insert` — riscritto per intero e non a memoria, perché un
-- `create or replace` parziale perde i rami che non si ricordano.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. Le due funzioni Amazon
-- --------------------------------------------------------------------
drop function if exists public.amazon_buy_url(uuid);
drop function if exists public.amazon_affiliate_url(text);

-- --------------------------------------------------------------------
-- 2. `internal_enrich_ingest` senza la scrittura di recensioni esterne
-- --------------------------------------------------------------------
create or replace function public.internal_enrich_ingest()
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  j       record;
  v_json  jsonb;
  v_title text;
  v_req   bigint;
  v_other text;
  v_key   text;
  v_desc  text;
  c_ua    constant jsonb := jsonb_build_object('User-Agent', 'TomoBeta/1.0 (book community app)');
begin
  for j in
    select ej.*, resp.status_code, resp.content
    from public.enrich_jobs ej
    join net._http_response resp on resp.id = ej.request_id
  loop
    if j.status_code = 200 then
      v_json := j.content::jsonb;

      if j.kind = 'ol_ratings' then
        update public.books
        set external_rating        = nullif((v_json -> 'docs' -> 0 ->> 'ratings_average'), '')::numeric,
            external_ratings_count = nullif((v_json -> 'docs' -> 0 ->> 'ratings_count'), '')::int
        where id = j.book_id;

        -- Chain to the work JSON for a description (obscure books included).
        v_key := v_json -> 'docs' -> 0 ->> 'key';
        if v_key is not null then
          select net.http_get(
            url := 'https://openlibrary.org' || v_key || '.json',
            headers := c_ua,
            timeout_milliseconds := 20000
          ) into v_req;
          insert into public.enrich_jobs (book_id, kind, request_id)
          values (j.book_id, 'ol_work', v_req);
        end if;

      elsif j.kind = 'ol_work' then
        -- description is either a plain string or { "type": ..., "value": ... }
        v_desc := coalesce(v_json ->> 'description', v_json -> 'description' ->> 'value');
        -- strip Open Library's trailing source footnotes, e.g. "([source][1])"
        v_desc := regexp_replace(coalesce(v_desc, ''), '\s*\(\[.*$', '');
        if length(trim(v_desc)) > 20 then
          update public.books
          set source_blurb_internal = left(trim(v_desc), 1500)
          where id = j.book_id and coalesce(source_blurb_internal, '') = '';
        end if;

      elsif j.kind in ('wiki_search_it', 'wiki_search_en') then
        v_title := v_json -> 'query' -> 'search' -> 0 ->> 'title';
        if v_title is not null then
          select net.http_get(
            url := 'https://' || j.lang || '.wikipedia.org/api/rest_v1/page/summary/'
                   || public.urlencode(replace(v_title, ' ', '_')),
            headers := c_ua,
            timeout_milliseconds := 20000
          ) into v_req;
          insert into public.enrich_jobs (book_id, kind, lang, payload, request_id)
          values (j.book_id, 'wiki_summary', j.lang, v_title, v_req);
        elsif j.kind = 'wiki_search_it' then
          select b2.title || ' ' || coalesce(b2.authors[1], '') into v_other
          from public.books b2 where b2.id = j.book_id;
          select net.http_get(
            url := 'https://en.wikipedia.org/w/api.php?action=query&list=search'
                   || '&format=json&srlimit=1&srsearch=' || public.urlencode(v_other || ' novel'),
            headers := c_ua,
            timeout_milliseconds := 20000
          ) into v_req;
          insert into public.enrich_jobs (book_id, kind, lang, request_id)
          values (j.book_id, 'wiki_search_en', 'en', v_req);
        end if;

      elsif j.kind = 'wiki_summary' then
        -- Il filtro resta identico: extract non vuoto, pagina `standard` e non
        -- una voce su film o serie tv. Cambia solo cosa se ne fa — prima
        -- l'extract diventava una recensione esterna *e* una sinossi grezza,
        -- ora solo la seconda.
        if coalesce(v_json ->> 'extract', '') <> ''
           and (v_json ->> 'type') = 'standard'
           and coalesce(v_json ->> 'description', '') !~* '(film|movie|miniserie|tv series|serie tv)' then
          update public.books
          set source_blurb_internal = left(v_json ->> 'extract', 1500)
          where id = j.book_id and coalesce(source_blurb_internal, '') = '';
        end if;
      end if;
    end if;

    delete from public.enrich_jobs where id = j.id;
  end loop;
end;
$function$;

-- La funzione la chiama solo il cron (`enrich-ingest`), che gira come
-- `postgres`. `create or replace` conserva i privilegi esistenti, ma la revoca
-- si riscrive comunque: così chi legge questa migrazione da sola vede che non è
-- una funzione esposta ai client.
revoke execute on function public.internal_enrich_ingest() from public, anon, authenticated;

-- --------------------------------------------------------------------
-- 3. Cosa questa migrazione NON fa, di proposito
-- --------------------------------------------------------------------
-- * Non fa `drop table public.external_reviews` (vedi sopra: 238 righe con
--   licenza, decisione presa).
-- * Non tocca `books.categories`: la colonna serve alla ricerca per genere,
--   alle pagine genere, ai consigli e all'inferenza automatica. Le categorie
--   sono via solo dalla *scheda* libro, che è codice client.
-- * Non tocca niente della lettura gratuita (`free_read_url`, `gutenberg_id`,
--   la edge function `read`): Amazon era la parte a pagamento, la parte gratis
--   è il cuore dell'app.
-- * Non elimina la riga `app_config.amazon_affiliate_tag` = `jacopoz-20`.
--   Da qui in poi nessuno la legge, quindi è inerte, ma `getAppConfig()` la
--   consegna ancora al client: se si vuole sparita davvero va una `delete` in
--   una migrazione a parte, presa come decisione consapevole e non di rimbalzo.

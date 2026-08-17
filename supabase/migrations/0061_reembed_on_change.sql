-- =====================================================================
-- 0061 — RE-EMB: ricalcolare gli embedding quando il testo cambia davvero
--
-- Le sinossi stanno arrivando (W2) e cambiano l'input degli embedding da una
-- riga di metadati a un paragrafo: misurato prima, la mediana era **66
-- caratteri**, con il 56% dei libri sotto i 70. A quella lunghezza il segnale
-- dominante era il nome dell'autore e l'ortografia della lingua — ed è il
-- motivo per cui i 200 filoni raggruppavano per autore e per lingua invece che
-- per contenuto.
--
-- Non serve però un "grande ricalcolo" da lanciare a mano il giorno in cui le
-- sinossi saranno abbastanza. Serve una regola: **un libro il cui testo è
-- cambiato ha un embedding scaduto.** Così RE-EMB avanza da solo, in passo con
-- W2, e vale anche per ogni futura modifica (una sinossi rigenerata con un
-- modello nuovo, categorie corrette, un titolo ripulito).
--
-- Il confronto è su un'impronta del testo, non sul testo: `books` ha 68.817
-- righe e tenerne due copie per confrontarle sarebbe spreco.
--
-- La pipeline esistente pesca `where embedding is null`: mettere a null
-- l'embedding di una riga scaduta la rimette in coda senza toccare quel codice.
-- Il prezzo è che per qualche minuto quel libro non ha vicini semantici; su un
-- catalogo di 68.000 e sei lettori è invisibile, ed è preferibile a duplicare
-- la logica di accodamento.
-- =====================================================================

alter table public.books
  add column if not exists embedding_text_hash text;

comment on column public.books.embedding_text_hash is
  'md5 di book_embedding_text() al momento del calcolo dell''embedding. '
  'Se non coincide con l''impronta attuale, l''embedding è scaduto.';

-- Le righe già calcolate portano l'impronta del testo con cui furono fatte:
-- senza, sembrerebbero tutte scadute e si ricalcolerebbe l'intero catalogo per
-- niente. A lotti, perché una passata unica su 68.817 righe supera il timeout.
create or replace function public.internal_stamp_embedding_hash(p_batch int default 4000)
returns int
language sql
volatile
security definer
set search_path = public, extensions
as $$
  with da_fare as (
    select b.id, md5(public.book_embedding_text(b.*)) as h
    from public.books b
    where b.embedding is not null and b.embedding_text_hash is null
    limit greatest(p_batch, 1)
  ),
  fatti as (
    update public.books b set embedding_text_hash = d.h
    from da_fare d where b.id = d.id
    returning 1
  )
  select count(*)::int from fatti;
$$;
revoke execute on function public.internal_stamp_embedding_hash(int) from public, anon, authenticated;

/**
 * Scade gli embedding il cui testo è cambiato, rimettendoli in coda.
 *
 * Solo cambiamenti **sostanziali**: una virgola in più nel titolo non giustifica
 * una chiamata a pagamento e un nuovo vettore. La soglia è la comparsa di una
 * sinossi, che è il salto che ci interessa — da una riga a un paragrafo.
 */
create or replace function public.internal_expire_embeddings(p_batch int default 200)
returns int
language sql
volatile
security definer
set search_path = public, extensions
as $$
  with scaduti as (
    select b.id
    from public.books b
    where b.embedding is not null
      and b.embedding_text_hash is not null
      and b.embedding_text_hash <> md5(public.book_embedding_text(b.*))
      -- Il salto che conta: il testo è cresciuto di almeno 120 caratteri.
      -- Ritoccare un titolo non deve costare un embedding.
      and length(public.book_embedding_text(b.*)) >= 120
    order by b.reads_count + b.saves_count + b.likes_count + b.reviews_count desc
    limit greatest(p_batch, 1)
  ),
  svuotati as (
    update public.books b
       set embedding = null, embedding_text_hash = null
    from scaduti s where b.id = s.id
    returning 1
  )
  select count(*)::int from svuotati;
$$;
revoke execute on function public.internal_expire_embeddings(int) from public, anon, authenticated;

-- Un giro ogni quarto d'ora: segue il ritmo delle sinossi (20 ogni 10 minuti)
-- senza mai mettere in coda più di quanto la pipeline degli embedding smaltisca.
select cron.schedule('reembed-changed', '7-59/15 * * * *',
  $$select public.internal_expire_embeddings(200)$$);

-- E l'impronta va messa anche sui vettori nuovi, altrimenti ogni libro appena
-- calcolato risulterebbe subito "senza impronta" e non verrebbe mai controllato.
select cron.schedule('stamp-embedding-hash', '*/5 * * * *',
  $$select public.internal_stamp_embedding_hash(4000)$$);

-- --------------------------------------------------------------------
-- Correzione di sequenza, una tantum
-- --------------------------------------------------------------------
-- L'impronta viene calcolata *adesso*, sul testo *di adesso*. Per i libri che
-- hanno già ricevuto una sinossi in questa prima ondata, il testo di adesso la
-- contiene già — quindi risulterebbero allineati mentre il loro vettore è stato
-- calcolato prima, sul testo corto. Sarebbero scaduti per sempre senza che
-- nessun controllo se ne accorgesse.
--
-- Vale solo per questa prima ondata: tutte le sinossi esistenti sono state
-- generate oggi, tutti gli embedding sono precedenti. Da domani in poi la
-- regola normale basta, perché l'impronta verrà scritta insieme al vettore.
update public.books
   set embedding = null, embedding_text_hash = null
 where synopsis is not null
   and embedding is not null;

-- --------------------------------------------------------------------
-- L'impronta va scritta insieme al vettore
-- --------------------------------------------------------------------
-- Marcarla da un cron separato lascia una finestra: se una sinossi arriva fra
-- il calcolo del vettore e la marcatura, il libro risulta allineato con un
-- vettore vecchio e non scade mai più. È esattamente il difetto corretto a mano
-- qui sopra per la prima ondata; scriverla nella stessa UPDATE lo rende
-- impossibile. Il cron `stamp-embedding-hash` resta solo per le righe storiche.
CREATE OR REPLACE FUNCTION public.internal_embed_ingest()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  r record;
begin
  for r in
    select eb.request_id, eb.book_ids, eb.kind, resp.status_code, resp.content
    from public.embed_batches eb
    join net._http_response resp on resp.id = eb.request_id
  loop
    if r.status_code = 200 then
      if r.kind = 'book' then
        update public.books b
        set embedding = (
          select ('[' || string_agg(e.value::text, ',') || ']')::extensions.vector(512)
          from (
            select value, row_number() over () as rn
            from jsonb_array_elements(d.elem -> 'embedding') as value
          ) e
          where e.rn <= 512
        ),
        -- L'impronta si scrive **insieme** al vettore, non da un cron a parte:
        -- se una sinossi arriva nella finestra fra i due, il libro verrebbe
        -- marcato come allineato con un vettore calcolato sul testo vecchio, e
        -- non scadrebbe mai più.
        embedding_text_hash = md5(public.book_embedding_text(b.*))
        from (
          select elem, (elem ->> 'index')::int as idx
          from jsonb_array_elements((r.content)::jsonb -> 'data') as elem
        ) d
        where b.id = r.book_ids[d.idx + 1];
      else
        update public.reviews rv
        set embedding = (
          select ('[' || string_agg(e.value::text, ',') || ']')::extensions.vector(512)
          from (
            select value, row_number() over () as rn
            from jsonb_array_elements(d.elem -> 'embedding') as value
          ) e
          where e.rn <= 512
        )
        from (
          select elem, (elem ->> 'index')::int as idx
          from jsonb_array_elements((r.content)::jsonb -> 'data') as elem
        ) d
        where rv.id = r.book_ids[d.idx + 1];
      end if;
    end if;
    delete from public.embed_batches where request_id = r.request_id;
  end loop;
end;
$function$;
revoke execute on function public.internal_embed_ingest() from public, anon, authenticated;

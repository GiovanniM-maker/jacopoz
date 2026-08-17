-- =====================================================================
-- 0063 — Una sinossi si scrive sui materiali, non sui ricordi del modello
--
-- Trovato controllando le prime 32 sinossi generate: **26 su 32 sono state
-- scritte senza alcun materiale**, solo da titolo, autore e categorie. Il
-- modello non ha risposto INSUFFICIENTE come gli era stato chiesto: ha
-- riconosciuto il titolo e ha raccontato il libro a memoria.
--
-- Per i classici spesso indovina. Ma:
--
--   «Oblivion» di David Foster Wallace → gli ha attribuito la trama di
--   «Infinite Jest» (Hal Incandenza, l'Accademia, il film che annulla ogni
--   altro intrattenimento), sbagliando anche quella. Sono due libri diversi.
--
--   «A ciascuno il suo» di Sciascia → due edizioni, due sinossi, entrambe
--   sbagliate e in modi diversi: nella prima le vittime hanno nomi inventati,
--   nella seconda muore all'inizio il personaggio che muore alla fine.
--
-- Una scheda vuota è un buco. Una scheda falsa è un danno: il lettore non ha
-- modo di accorgersene, e il testo finisce anche nell'embedding, quindi
-- avvelena i vicini semantici e i filoni.
--
-- La correzione non è un'altra riga nel prompt. Il prompt lo diceva già:
-- «Se i materiali non bastano rispondi INSUFFICIENTE». Un prompt è una
-- richiesta, non una garanzia. La garanzia è un vincolo: **senza quarta di
-- copertina non si genera**.
--
-- Il costo è duro e va detto: 729 libri su 68.817 hanno materiale, l'1%. La
-- coda delle sinossi si riduce a quei 729 finché non arriva materiale nuovo.
-- Il collo di bottiglia di W2 non era il modello né il budget: sono le
-- descrizioni. Il prossimo passo è recuperarle (Google Books ne restituisce
-- per gran parte dei 31.560 libri che hanno un ISBN), non generare di più.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. Ritirare le sinossi non fondate
-- --------------------------------------------------------------------
-- `synopsis_inputs` registra da quali campi è stata scritta: quelle che non
-- hanno letto `source_blurb_internal` sono, per costruzione, ricordi.
-- L'embedding torna a null insieme alla sinossi: è stato calcolato su un testo
-- che stiamo dichiarando falso, e va rifatto sui soli metadati.
-- (`internal_expire_embeddings` da solo non basterebbe: pretende un testo di
-- almeno 120 caratteri, e senza sinossi si torna sotto la soglia.)
update public.books
   set synopsis = null,
       synopsis_source = null,
       synopsis_model = null,
       synopsis_prompt_version = null,
       synopsis_generated_at = null,
       synopsis_inputs = null,
       synopsis_attempts = 0,
       synopsis_skip_reason = null,
       embedding = null,
       embedding_text_hash = null
 where synopsis is not null
   and not ('source_blurb_internal' = any(coalesce(synopsis_inputs, array[]::text[])));

-- --------------------------------------------------------------------
-- 2. La coda pesca solo dove c'è materiale
-- --------------------------------------------------------------------
create or replace function public.internal_synopsis_queue(p_limit int default 20)
returns table (id uuid, title text, authors text[], priorita int)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with visti as (
    -- Il client scrive `bookId`, non `book_id`: leggerne una sola avrebbe reso
    -- il segnale più importante della coda — i libri che qualcuno ha davvero
    -- aperto — invisibile, senza che niente andasse in errore.
    select coalesce(e.props ->> 'bookId', e.props ->> 'book_id')::uuid as bid, count(*)::int n
    from public.analytics_events e
    where coalesce(e.props ->> 'bookId', e.props ->> 'book_id') ~ '^[0-9a-f-]{36}$'
    group by 1
  ),
  scaffale as (
    select ub.book_id as bid, count(*)::int n
    from public.user_books ub group by 1
  )
  select b.id, b.title, b.authors,
    (coalesce(case when v.n > 0 then 1000 + least(v.n, 500) else 0 end, 0)
     + coalesce(case when s.n > 0 then 500 + least(s.n * 50, 400) else 0 end, 0)
     + case when b.cover_url is not null then 50 else 0 end
     + least((b.reads_count + b.saves_count + b.likes_count + b.reviews_count) * 5, 200)
     + least(round(coalesce(b.external_rating, 0) * 10)::int, 50)
     - b.synopsis_attempts * 300
    ) as priorita
  from public.books b
  left join visti v on v.bid = b.id
  left join scaffale s on s.bid = b.id
  where b.synopsis is null
    and b.synopsis_attempts < 2
    -- Il vincolo. Cento caratteri: sotto, una "descrizione" è quasi sempre
    -- una riga di catalogo ("Romanzo. Traduzione di...") da cui il modello
    -- ricadrebbe comunque nella memoria.
    and length(coalesce(b.source_blurb_internal, '')) >= 100
  order by priorita desc, b.id
  limit greatest(p_limit, 0);
$$;
revoke execute on function public.internal_synopsis_queue(int) from public, anon, authenticated;
grant execute on function public.internal_synopsis_queue(int) to service_role;

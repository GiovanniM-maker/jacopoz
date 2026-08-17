-- =====================================================================
-- 0074 — Togliere carico invece di comprare RAM
--
-- Dopo il guasto di stamattina (database irraggiungibile per ~2 ore, Postgres
-- mai riavviato, disco a 495 MB su gigabyte disponibili) il sospetto è
-- pressione di risorse su un'istanza Micro: 1 GB di RAM, 224 MB di
-- shared_buffers, 60 connessioni.
--
-- Misurato invece che supposto, ecco cosa facevano davvero i lavori pianificati:
--
--   enrich_da_fare              0
--   libri senza categorie       0
--   libri senza filone          0
--   libri senza vettore         0
--   recensioni senza vettore    0
--
-- **Tutti a zero.** Nove lavori sotto i cinque minuti che si svegliano per
-- scandire tabelle da 68.877 righe e non trovare niente da fare.
--
-- E soprattutto `warm-vectors`, che gira **ogni minuto**:
--
--   pg_prewarm('books_embedding_halfvec_hnsw')   91 MB
--   pg_prewarm('books')                          79 MB
--                                               ------
--                                               170 MB  in 224 MB di buffer
--
-- Cioè tre quarti della cache condivisa riempiti da capo ogni sessanta secondi,
-- sfrattando tutto il resto — feed, profili, liste — anche quando nessuno ha
-- cercato niente. Aveva senso quando la tabella era piccola; adesso è la voce
-- di carico più grossa che abbiamo, e non la nota nessuno perché non fallisce
-- mai: consuma e basta.
--
-- Niente qui rende l'app più lenta per chi la usa: i libri appena importati
-- vengono già vettorizzati **subito** da `ingest-book`, e questi cron sono la
-- rete di sicurezza dietro. Una rete di sicurezza può controllare ogni quarto
-- d'ora invece che ogni cinque minuti.
-- =====================================================================

-- L'indice va tenuto caldo, ma non ricaricato da zero ogni minuto.
select cron.unschedule('warm-vectors');
select cron.schedule('warm-vectors', '*/5 * * * *',
  $$select public.internal_keep_vectors_warm()$$);

-- Vettori: la strada calda è sincrona dentro l'import, questa è la riserva.
select cron.unschedule('embed-enqueue');
select cron.schedule('embed-enqueue', '*/15 * * * *',
  $$select public.internal_embed_enqueue()$$);

select cron.unschedule('embed-enqueue-reviews');
select cron.schedule('embed-enqueue-reviews', '5-59/15 * * * *',
  $$select public.internal_embed_enqueue_reviews()$$);

-- Deve seguire l'accodamento, non precederlo.
select cron.unschedule('embed-ingest');
select cron.schedule('embed-ingest', '10-59/15 * * * *',
  $$select public.internal_embed_ingest()$$);

-- Arricchimento: da quando le descrizioni arrivano da Google Books (0064)
-- questa strada porta soprattutto voti esterni, che non hanno fretta.
select cron.unschedule('enrich-enqueue');
select cron.schedule('enrich-enqueue', '3,33 * * * *',
  $$select public.internal_enrich_enqueue()$$);

select cron.unschedule('enrich-ingest');
select cron.schedule('enrich-ingest', '8,38 * * * *',
  $$select public.internal_enrich_ingest()$$);

select cron.unschedule('infer-categories');
select cron.schedule('infer-categories', '13,43 * * * *',
  $$select public.internal_infer_categories(150)$$);

select cron.unschedule('cluster-new-books');
select cron.schedule('cluster-new-books', '18,48 * * * *',
  $$select public.internal_cluster_new_books(500)$$);

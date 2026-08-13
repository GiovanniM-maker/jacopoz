-- =====================================================================
-- 0067 — L'impronta anche sulla seconda strada che scrive un embedding
--
-- 0061 ha spostato la scrittura dell'impronta dentro la stessa UPDATE del
-- vettore, in `internal_embed_ingest`, per chiudere questa finestra: se una
-- sinossi arriva fra il calcolo del vettore e la marcatura, il libro risulta
-- allineato con un vettore calcolato sul testo vecchio e **non scade mai più**.
--
-- Ma `internal_embed_ingest` non è l'unica strada. `set_book_embeddings` è
-- l'altra: la chiama la funzione di import per vettorizzare subito un libro
-- appena cercato, invece di aspettare il cron dei cinque minuti. Lì l'impronta
-- non veniva scritta, e la finestra restava aperta esattamente com'era —
-- proprio sui libri appena importati, che sono quelli con più probabilità di
-- ricevere una descrizione e poi una sinossi nei minuti successivi.
--
-- Chiuderla in un posto solo e lasciarla aperta nell'altro non è chiuderla.
-- =====================================================================

create or replace function public.set_book_embeddings(p_rows jsonb)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count int;
begin
  update public.books b
  set embedding = (r.elem -> 'e')::text::extensions.vector(512),
      -- Calcolata dal database sul testo che il database vede in questo
      -- istante: è l'unico modo perché combaci con quella che il controllo di
      -- scadenza ricalcolerà. Farla dal client vorrebbe dire riprodurre
      -- book_embedding_text() in TypeScript e tenerla allineata a mano.
      embedding_text_hash = md5(public.book_embedding_text(b.*))
  from (select jsonb_array_elements(p_rows) as elem) r
  where b.id = (r.elem ->> 'id')::uuid;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

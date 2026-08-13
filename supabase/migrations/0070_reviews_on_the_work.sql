-- =====================================================================
-- 0070 — W1b: una recensione parla dell'opera, non dell'edizione
--
-- Oggi `reviews.book_id` punta a una riga di `books`, che è un'**edizione**.
-- Il catalogo ha 144 opere con più di un'edizione, e su quelle:
--
--   • chi apre l'Adelphi non vede la recensione scritta sull'Einaudi;
--   • la scheda dell'una dice «3 recensioni» e quella dell'altra «nessuna»;
--   • lo stesso lettore può recensire due volte lo stesso libro senza che
--     niente glielo impedisca, perché il vincolo è su (utente, edizione).
--
-- Si fa adesso perché ci sono **14 recensioni**: la migrazione dei dati è una
-- riga. Fra sei mesi sarebbe la stessa migrazione con il rischio di rompere
-- contenuti che le persone tengono.
--
-- --------------------------------------------------------------------
-- Perché un uuid e non `work_key`
-- --------------------------------------------------------------------
-- `work_key` è testo derivato da titolo e autore, ricalcolato da un trigger a
-- ogni scrittura. Appenderci sopra le recensioni vorrebbe dire che correggere
-- un refuso nel titolo le stacca dal loro libro. Serve un'identità che non
-- cambi quando cambia ciò da cui è stata dedotta: `work_id`, un uuid stabile,
-- condiviso da tutte le edizioni della stessa opera.
--
-- Non è una tabella `works` perché oggi l'opera non ha attributi propri da
-- conservare: sarebbe un sacchetto di id. Se un giorno ne avrà (una copertina
-- canonica, un titolo preferito), promuovere la colonna a tabella è meccanico.
-- =====================================================================

alter table public.books add column if not exists work_id uuid;

comment on column public.books.work_id is
  'Identità stabile dell''opera, condivisa da tutte le sue edizioni. '
  'Dedotta da work_key ma non uguale ad esso: work_key cambia se cambia il '
  'titolo, work_id no — ed è a questo che sono appese le recensioni.';

-- --------------------------------------------------------------------
-- Il riempimento va a lotti, non qui dentro
-- --------------------------------------------------------------------
-- Primo tentativo: un solo UPDATE su tutte e 68.877 le righe. È andato oltre
-- i due minuti ed è stato annullato — e il costo era prevedibile: aggiungere
-- una colonna fa crescere la riga, quindi l'aggiornamento non è HOT e tocca
-- **tutti** gli indici della tabella, compreso l'HNSW da 88 MB sugli
-- embedding. Riscrivere 68.877 voci di un indice vettoriale per riempire una
-- colonna di uuid non è una cosa da fare in una transazione sola.
--
-- Quindi la colonna nasce annullabile, si riempie a lotti da fuori, e solo
-- alla fine (0071) diventa obbligatoria.
create or replace function public.internal_backfill_work_id(p_batch int default 3000)
returns int
language sql
volatile
security definer
set search_path = public
as $$
  with da_fare as (
    select b.id, b.work_key
    from public.books b
    where b.work_id is null
    order by b.work_key nulls last
    limit greatest(p_batch, 1)
  ),
  -- Le edizioni della stessa opera devono ricevere lo stesso uuid anche se
  -- cadono in lotti diversi: se una sorella è già stata riempita si riusa il
  -- suo, altrimenti se ne conia uno per la chiave.
  assegnate as (
    select d.id, d.work_key,
      coalesce(
        (select b2.work_id from public.books b2
          where b2.work_key = d.work_key and b2.work_id is not null limit 1),
        first_value(gen_random_uuid()) over (partition by d.work_key),
        d.id
      ) as wid
    from da_fare d
  ),
  fatte as (
    update public.books b set work_id = a.wid
    from assegnate a where b.id = a.id
    returning 1
  )
  select count(*)::int from fatte;
$$;
revoke execute on function public.internal_backfill_work_id(int) from public, anon, authenticated;

create index if not exists books_work_id_idx on public.books (work_id);
create index if not exists books_work_key_idx on public.books (work_key)
  where work_key is not null;

-- --------------------------------------------------------------------
-- Il trigger che tiene insieme le edizioni
-- --------------------------------------------------------------------
-- `security definer` non è pigrizia: 0059 ha revocato la SELECT su `books` e
-- ridato i permessi colonna per colonna, e `work_id` è nata adesso, quindi non
-- è fra quelle. Un trigger che gira con l'identità di chi scrive non riuscirebbe
-- a leggere l'identità delle edizioni sorelle.
create or replace function public.tg_books_work_key()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wid uuid;
begin
  new.work_key := public.work_key(new.title, new.authors);

  if new.work_key is not null then
    -- Un'edizione nuova prende l'identità delle sorelle già in catalogo.
    select b.work_id into v_wid
    from public.books b
    where b.work_key = new.work_key and b.id <> new.id
    limit 1;
  end if;

  -- Un titolo corretto può spostare il libro su un'altra opera: se ne esiste
  -- già una con la chiave nuova ci si aggancia, altrimenti si tiene la propria
  -- identità invece di crearne una terza — così le recensioni già scritte non
  -- restano orfane.
  new.work_id := coalesce(v_wid, new.work_id, gen_random_uuid());
  return new;
end;
$$;

revoke execute on function public.tg_books_work_key() from public, anon, authenticated;

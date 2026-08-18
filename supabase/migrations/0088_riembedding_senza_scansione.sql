-- =====================================================================
-- 0088 — Un minuto di CPU ogni quarto d'ora, per scoprire ciò che si poteva
--        sapere al momento della scrittura
--
-- Trovata cercando perché la semina dei filoni non finiva mai. Guardando
-- `pg_stat_activity` mentre la mia funzione arrancava:
--
--   pid 15098  active  00:01:08  select public.internal_expire_embeddings(200)
--
-- Sessantotto secondi, e quel lavoro parte **ogni quindici minuti** (cron
-- `reembed-changed`). Non era un caso: è la sua durata normale.
--
-- --------------------------------------------------------------------
-- Cosa faceva
-- --------------------------------------------------------------------
--   where b.embedding_text_hash <> md5(public.book_embedding_text(b.*))
--     and length(public.book_embedding_text(b.*)) >= 120
--
-- `book_embedding_text` concatena titolo, autori, categorie e sinossi: viene
-- calcolata **due volte per riga**, su tutte le 69.059 righe, per scoprire quali
-- hanno il testo cambiato. Nessun indice può aiutare — è una scansione completa
-- con due chiamate di funzione per riga, seguita da un ordinamento.
--
-- L'ironia è che `embedding_text_hash` esiste esattamente per non doverlo fare:
-- 0067 lo scrive quando l'embedding viene calcolato. Ma il confronto ha bisogno
-- del testo *attuale*, e quello si ricalcolava sempre da capo.
--
-- --------------------------------------------------------------------
-- Cosa cambia
-- --------------------------------------------------------------------
-- Chi sa che il testo è cambiato è chi lo cambia. Un trigger sulle cinque
-- colonne da cui `book_embedding_text` dipende — title, authors, categories,
-- synopsis, source_blurb_internal — alza una bandierina; la funzione periodica
-- legge la bandierina da un indice parziale invece di scandire il catalogo.
--
-- Il costo si sposta sulle scritture, ed è il posto giusto: nelle ultime
-- ventiquattr'ore i libri modificati sono stati qualche migliaio, contro
-- 69.059 righe × 2 × 96 volte al giorno.
--
-- Perché una bandierina e non l'invalidazione diretta nel trigger: azzerare
-- `embedding` dentro il trigger farebbe sparire dai consigli e dalla ricerca
-- semantica **tutti** i libri toccati da un aggiornamento di massa, tutti
-- insieme. 0085 ne ha toccati 2.110 in un colpo. La bandierina lascia
-- l'invalidazione al lavoro periodico, che ne prende duecento per volta e
-- comincia dai più letti — cioè il comportamento di prima, senza la scansione.
-- =====================================================================

alter table public.books
  add column if not exists embedding_stale boolean not null default false;

-- Indice parziale: contiene solo le righe da riembeddare, che in regime sono
-- poche decine. È ciò che sostituisce la scansione da 69.059 righe.
create index if not exists books_embedding_stale_idx on public.books (id)
  where embedding_stale;

-- --------------------------------------------------------------------
-- Il trigger
-- --------------------------------------------------------------------
create or replace function public.tg_books_embedding_stale()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_testo text := public.book_embedding_text(new.*);
begin
  -- Il confronto con l'hash memorizzato, non con il valore precedente: se una
  -- scrittura cambia il titolo e una seconda lo rimette com'era, il testo torna
  -- quello dell'embedding esistente e non c'è niente da rifare.
  --
  -- E la soglia dei 120 caratteri sta **qui**, non solo nel lavoro periodico.
  -- Altrimenti un libro con poco testo verrebbe segnato a ogni ritocco e non
  -- verrebbe mai ripreso — la bandierina resterebbe accesa per sempre e
  -- l'indice parziale, che esiste per contenere «le poche righe da rifare»,
  -- si riempirebbe di righe che non si faranno mai. Misurato: la marcatura
  -- iniziale ne aveva già segnate centinaia così.
  if length(v_testo) >= 120
     and (new.embedding_text_hash is null
          or md5(v_testo) is distinct from new.embedding_text_hash) then
    new.embedding_stale := true;
  end if;
  return new;
end;
$$;
revoke execute on function public.tg_books_embedding_stale() from public, anon, authenticated;

drop trigger if exists books_embedding_stale on public.books;
create trigger books_embedding_stale
  before update of title, authors, categories, synopsis, source_blurb_internal
  on public.books
  for each row
  execute function public.tg_books_embedding_stale();

-- --------------------------------------------------------------------
-- La funzione periodica, senza più la scansione
-- --------------------------------------------------------------------
create or replace function public.internal_expire_embeddings(p_batch integer default 200)
returns integer
language sql
security definer
set search_path to 'public', 'extensions'
-- Anche questa porta il suo limite: se un giorno tornasse lenta deve fallire,
-- non occupare l'istanza. Vedi A-4 in docs/PIANO-PRESTAZIONI.md.
set statement_timeout = '30s'
as $$
  with scaduti as (
    select b.id
    from public.books b
    where b.embedding_stale
      and b.embedding is not null
      -- Il salto che conta: il testo è cresciuto abbastanza da valere un
      -- embedding. Ora si calcola solo sulle righe segnate, non su tutte.
      and length(public.book_embedding_text(b.*)) >= 120
    order by b.reads_count + b.saves_count + b.likes_count + b.reviews_count desc
    limit greatest(p_batch, 1)
  ),
  svuotati as (
    update public.books b
       set embedding = null, embedding_text_hash = null, embedding_stale = false
    from scaduti s where b.id = s.id
    returning 1
  )
  select count(*)::int from svuotati;
$$;
revoke execute on function public.internal_expire_embeddings(int) from public, anon, authenticated;

-- --------------------------------------------------------------------
-- Le righe già scadute oggi
-- --------------------------------------------------------------------
-- La bandierina nasce spenta, quindi i libri il cui testo è cambiato **prima**
-- di questa migrazione non verrebbero mai ripresi. Vanno segnati una volta, e
-- quella volta costa esattamente quanto costava un giro del cron.
--
-- Non si fa qui dentro: si fa da fuori, a fette per intervallo di id, guardando
-- i lettori fra una fetta e l'altra. Una query da settanta secondi dentro una
-- migrazione è il modo in cui ho fermato la base dati due volte stamattina.
-- Vedi lo script in fondo a questo file.

comment on column public.books.embedding_stale is
  'Il testo da cui si calcola l''embedding è cambiato dopo l''ultimo calcolo. '
  'Alzata dal trigger books_embedding_stale, abbassata da internal_expire_embeddings.';

-- =====================================================================
-- 0087 — I filoni sul catalogo italiano, che è quello che la Home mostra
--
-- I 200 filoni calcolati il 2 agosto avevano due problemi, e nessuno dei due
-- era il modo in cui erano calcolati:
--
--   1. **Non li leggeva nessuno.** `get_reader_clusters` e `get_cluster_books`
--      non sono chiamate da nessuna schermata del client. Il cron
--      `cluster-new-books` li aggiornava ogni mezz'ora per nessuno.
--
--   2. **157 su 200 hanno meno del 10% di libri italiani**, 31 non ne hanno
--      nemmeno uno. Da quando la Home mostra solo italiano (0082) quei filoni
--      non potrebbero riempire una riga neanche se li si collegasse.
--
-- Quindi non si ricalcola la stessa cosa: si raggruppa **il catalogo che la Home
-- mostra**. 8.402 libri italiani con embedding, 6.993 con copertina.
--
-- --------------------------------------------------------------------
-- Perché la stessa tabella e non una nuova
-- --------------------------------------------------------------------
-- `book_clusters` e `books.cluster_id` restano, e cambia la popolazione: i libri
-- non italiani perdono il filone. Non è una perdita — quei filoni non erano
-- letti da niente — ed evita di avere due concetti di «filone» che vogliono dire
-- cose diverse. `books_cluster_idx` è parziale su `cluster_id is not null` e
-- passa da 69.061 righe a 8.402.
--
-- --------------------------------------------------------------------
-- La semina di 0055 qui darebbe 32 candidati
-- --------------------------------------------------------------------
-- 0055 sceglie i semi fra i libri con copertina **e** almeno un segnale di
-- lettura o di giudizio: `reads_count + likes_count + external_ratings_count > 0`.
-- Sul catalogo intero funzionava. Sul sottoinsieme italiano:
--
--   italiani con embedding                             8.402
--   con copertina                                      6.993
--   che passano il filtro di 0055                         32   ← la semina
--   con una sinossi o del materiale vero                 360
--
-- Trentadue. Seminare quaranta filoni da trentadue candidati non è una semina
-- sparsa, è prendere quei trentadue libri. Il segnale di lettura non esiste
-- perché i lettori sono tre, e `external_ratings_count` è popolato su 245 libri
-- su 69.029 in tutto il catalogo.
--
-- La copertina da sola resta un filtro sensato — un libro senza copertina non
-- deve dare il nome a un filone — e lascia 6.993 candidati. È quello che si usa.
--
-- --------------------------------------------------------------------
-- Ogni funzione porta il suo limite
-- --------------------------------------------------------------------
-- Il 18 agosto ho fermato la base dati due volte con query da catalogo intero
-- (vedi A-4 in docs/PIANO-PRESTAZIONI.md). Il ruolo `postgres` non ha
-- `statement_timeout`: è comodo per le migrazioni ed è esattamente ciò che ha
-- permesso il guasto. Da qui in avanti queste funzioni muoiono da sole invece di
-- portarsi via i lettori — e i numeri sono scelti perché la funzione **fallisca**
-- se diventa lenta, non perché ci stia comoda.
-- =====================================================================

-- --------------------------------------------------------------------
-- Il vincolo che rendeva lenta la semina, e non era la semina
-- --------------------------------------------------------------------
-- Prima di arrivarci ho provato quattro varianti dell'algoritmo di semina e le
-- ho misurate tutte. Nessuna finiva, nemmeno con k=5. Il motivo non era in
-- nessuna di loro:
--
--   books_cluster_id_fkey  FOREIGN KEY (cluster_id) REFERENCES book_clusters(id)
--                          ON DELETE SET NULL
--
-- `delete from public.book_clusters` — la prima riga di ogni semina, in tutte le
-- versioni — fa scattare la cascata su **69.061 righe di `books`**. Ogni riga
-- riscritta è larga: dentro c'è l'embedding. Un centinaio di megabyte di
-- riscritture più la manutenzione di tutti gli indici di `books`, dentro la
-- stessa transazione della semina.
--
-- Le tre ipotesi che avevo fatto prima — la larghezza delle righe temporanee, le
-- versioni morte, il carico di fondo — erano tutte plausibili e tutte sbagliate.
-- Quella giusta stava in `pg_constraint`, dove avrei dovuto guardare dopo il
-- secondo tentativo e non dopo il quarto.
--
-- **Il vincolo si toglie.** Non è una scorciatoia per fare prima: è che il suo
-- valore protettivo qui è nullo e il suo costo è O(catalogo) a ogni ricalcolo.
-- Tutte le letture passano da `get_reader_clusters`, che fa join con
-- `book_clusters`: un `cluster_id` che non corrisponde a niente semplicemente non
-- compare da nessuna parte. Non è un dato sbagliato che si vede, è un dato che
-- non si vede.
--
-- Perché allora i nuovi filoni partono da 1000: i libri non italiani si portano
-- dietro i vecchi id 1..200, e se i nuovi filoni riusassero quei numeri un libro
-- inglese finirebbe dentro un filone italiano. Con gli id disgiunti il residuo è
-- inerte, e `internal_cluster_new_books` lo ripulisce un po' per volta.
alter table public.books drop constraint if exists books_cluster_id_fkey;

-- --------------------------------------------------------------------
-- Nota storica: la semina
-- --------------------------------------------------------------------
-- Prima di arrivarci ho provato quattro varianti dell'algoritmo di semina e le
-- ho misurate tutte. Nessuna finiva, nemmeno con k=5. Il motivo non era in
-- nessuna di loro:
--
--   books_cluster_id_fkey  FOREIGN KEY (cluster_id) REFERENCES book_clusters(id)
--                          ON DELETE SET NULL
--
-- `delete from public.book_clusters` — la prima riga di ogni semina, in tutte le
-- versioni — fa scattare la cascata su **69.061 righe di `books`**. Ogni riga
-- riscritta è una riga larga: dentro c'è l'embedding, mezzo kilobyte per libro.
-- Un centinaio di megabyte di riscritture più la manutenzione di tutti gli
-- indici di `books`, dentro la stessa transazione della semina.
--
-- Quindi il conto della semina non era mai il conto della semina. Le tre ipotesi
-- che avevo fatto prima — la larghezza delle righe temporanee, le versioni
-- morte, il carico di fondo — erano tutte plausibili, e tutte sbagliate. Quella
-- giusta si vedeva in `pg_constraint`, che è il posto in cui avrei dovuto
-- guardare dopo il secondo tentativo, non dopo il quarto.
--
-- Lo svuotamento di `books.cluster_id` va quindi fatto **una volta, a fette,
-- fuori dalla semina**, come si è fatto per la marcatura in 0088. Dopo, la
-- `delete` non ha più righe da mettere a null e costa niente.

-- --------------------------------------------------------------------
-- Semina: campione casuale deterministico, e non farthest-point
-- --------------------------------------------------------------------
-- 0055 seminava col farthest-point — prendere ogni volta il candidato più
-- lontano da tutti i semi già scelti — con questo argomento, che era buono:
-- «seminare a caso su un catalogo sbilanciato produce venti cluster di
-- narrativa e uno di tutto il resto».
--
-- Su questa istanza non finisce. Ho provato quattro varianti e ne ho misurata
-- ognuna:
--
--   0055 originale, 3.000 candidati        muore al limite (2,34 M di distanze)
--   minimo tenuto aggiornato               muore al limite
--   vettori in una tabella separata        muore al limite
--   campione a 1.000, senza indice         muore al limite anche con k=5
--
-- Con k=5, cioè quattro giri, sopra i 120 secondi: il costo non è nel numero di
-- distanze, è che ogni giro riscrive e rilegge una tabella temporanea e il
-- planner, che sulle tabelle temporanee non ha statistiche, sceglie male. Ho
-- aggiunto `analyze` e non è bastato.
--
-- **Quindi si cambia strumento invece di continuare a limarlo.** Semina
-- casuale, deterministica (`md5` sull'id, così due esecuzioni danno gli stessi
-- semi), e si lascia lavorare k-means. L'argomento di 0055 resta valido in
-- generale, ma qui la popolazione è un ottavo di quella per cui era stato
-- scritto — 8.402 libri invece di 69.000 — e i cluster vuoti o minuscoli
-- vengono comunque eliminati a ogni iterazione.
--
-- Il modo di sapere se è abbastanza buono non è discuterne: è **guardare la
-- distribuzione delle dimensioni dopo**, ed è scritto nel commit.
create or replace function public.internal_seed_clusters(p_k int default 40)
returns int
language plpgsql
volatile
security definer
set search_path = public, extensions
set statement_timeout = '60s'
set lock_timeout = '10s'
as $$
begin
  delete from public.book_clusters;

  insert into public.book_clusters (id, centroid, size)
  -- 1000 + n: disgiunti dai vecchi id 1..200 che i libri non italiani si
  -- portano ancora dietro. Vedi la nota sul vincolo, sopra.
  select 1000 + row_number() over (order by s.id), s.embedding, 0
  from (
    select b.id, b.embedding
    from public.books b
    where b.embedding is not null
      and b.cover_url is not null
      and b.language = 'it'
    -- Deterministica: la stessa semina a ogni esecuzione, così un ricalcolo è
    -- riproducibile e due filoni non si scambiano il nome per caso.
    order by md5(b.id::text || 'filone-it')
    limit greatest(p_k, 1)
  ) s;

  return (select count(*)::int from public.book_clusters);
end;
$$;
revoke execute on function public.internal_seed_clusters(int) from public, anon, authenticated;

-- --------------------------------------------------------------------
-- Un giro di k-means, sui soli libri italiani
-- --------------------------------------------------------------------
create or replace function public.internal_cluster_iterate()
returns int
language plpgsql
volatile
security definer
set search_path = public, extensions
set statement_timeout = '120s'
set lock_timeout = '10s'
as $$
declare
  v_moved int;
begin
  drop table if exists _cent;
  create temp table _cent on commit drop as
    select c.id, c.centroid::extensions.halfvec(512) as e from public.book_clusters c;
  create index on _cent (id);

  -- Qui stava un `update books set cluster_id = null` per tutti i non italiani:
  -- 60.659 righe larghe a ogni iterazione. Non serve più — i loro id non
  -- corrispondono a nessun filone e sono invisibili — e la ripulitura vera
  -- avviene a piccole dosi in `internal_cluster_new_books`.

  with assegnati as (
    select b.id,
           (select c.id from _cent c
             order by c.e <=> (b.embedding::extensions.halfvec(512)) limit 1) as cl
    from public.books b
    where b.embedding is not null and b.language = 'it'
  ),
  cambiati as (
    update public.books b set cluster_id = a.cl
    from assegnati a
    where b.id = a.id and b.cluster_id is distinct from a.cl
    returning 1
  )
  select count(*)::int into v_moved from cambiati;

  -- `avg()` lavora su `vector`, non su halfvec: la media si fa a piena
  -- precisione e si accorcia solo al confronto.
  update public.book_clusters c
  set centroid = agg.m, size = agg.n, updated_at = now()
  from (
    -- Il join, non `cluster_id is not null`: senza il vincolo di chiave esterna
    -- i libri non italiani conservano l'id di un filone che non c'è più.
    select b.cluster_id cl, avg(b.embedding) m, count(*)::int n
    from public.books b
    join public.book_clusters c2 on c2.id = b.cluster_id
    where b.embedding is not null
    group by b.cluster_id
  ) agg
  where c.id = agg.cl;

  delete from public.book_clusters where size = 0;

  return v_moved;
end;
$$;
revoke execute on function public.internal_cluster_iterate() from public, anon, authenticated;

-- --------------------------------------------------------------------
-- I libri nuovi: solo quelli italiani entrano in un filone
-- --------------------------------------------------------------------
create or replace function public.internal_cluster_new_books(p_batch int default 500)
returns int
language plpgsql
volatile
security definer
set search_path = public, extensions
set statement_timeout = '60s'
set lock_timeout = '10s'
as $$
declare v_n int;
begin
  if not exists (select 1 from public.book_clusters) then return 0; end if;
  drop table if exists _c;
  create temp table _c on commit drop as
    select c.id, c.centroid::extensions.halfvec(512) e from public.book_clusters c;

  with da_fare as (
    select b.id, b.embedding::extensions.halfvec(512) e
    from public.books b
    where b.cluster_id is null and b.embedding is not null and b.language = 'it'
    limit greatest(p_batch, 1)
  ),
  scelti as (
    select d.id, (select c.id from _c c order by c.e <=> d.e limit 1) as cl
    from da_fare d
  ),
  fatti as (
    update public.books b set cluster_id = s.cl
    from scelti s where b.id = s.id
    returning 1
  )
  select count(*)::int into v_n from fatti;

  -- Ripulitura graduale del residuo: fino a `p_batch` libri che puntano a un
  -- filone che non esiste più. A duecento per volta, due volte l'ora, il residuo
  -- di 37.690 righe sparisce in qualche giorno senza che nessuno se ne accorga —
  -- che è il contrario di farlo in un colpo solo e fermare la base dati.
  update public.books b set cluster_id = null
  where b.id in (
    select x.id from public.books x
    where x.cluster_id is not null
      and not exists (select 1 from public.book_clusters c where c.id = x.cluster_id)
    limit greatest(p_batch, 1)
  );

  return coalesce(v_n, 0);
end;
$$;
revoke execute on function public.internal_cluster_new_books(int) from public, anon, authenticated;

-- --------------------------------------------------------------------
-- I libri di un filone
-- --------------------------------------------------------------------
-- Il filtro di lingua non c'è perché non serve più: dopo questa migrazione un
-- libro con un `cluster_id` è italiano per costruzione.
--
-- L'ordinamento invece cambia, ed è la stessa correzione di 0082: era
-- `external_rating * ln(2 + conteggio)`, che è zero per il 99,65% del catalogo.
-- Una chiave che pareggia sempre non è una chiave, e il seme che dovrebbe far
-- ruotare la riga moltiplicava zero.
create or replace function public.get_cluster_books(
  p_cluster int,
  p_limit int default 12,
  p_seed int default 0
)
returns setof public.book_card
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year::int, b.categories,
    case when b.rating_count > 0
         then round(b.rating_sum::numeric / b.rating_count, 2) else null end,
    b.reads_count, b.saves_count, b.likes_count, b.reviews_count
  from public.books b
  where b.cluster_id = p_cluster
    and b.cover_url is not null
    and not exists (
      select 1 from public.user_books ub
      where ub.user_id = auth.uid() and ub.book_id = b.id
    )
  order by (b.synopsis is not null) desc,
           (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000) desc
  limit greatest(p_limit, 0);
$$;
grant execute on function public.get_cluster_books(int, int, int) to authenticated, anon;

-- --------------------------------------------------------------------
-- I filoni di un lettore
-- --------------------------------------------------------------------
-- Aggiunta rispetto a 0055: `riempibili`, cioè quante carte quel filone può
-- davvero mostrare a **questo** lettore. Serve alla Home per non proporre una
-- sezione che non arriva a quattro carte — la regola H-8, imparata in 0083 con
-- le righe «Ancora <autore>».
--
-- Aggiungere una colonna al risultato cambia il tipo di ritorno, che
-- `create or replace` non può fare: serve un DROP. Qui è senza conseguenze
-- perché nessuna schermata la chiama ancora — è proprio il difetto che questa
-- coppia di migrazioni sta correggendo — ma vale la pena scriverlo: se un giorno
-- lo fosse, fra il drop e il create ci sarebbe una finestra senza funzione.
drop function if exists public.get_reader_clusters(int);
create or replace function public.get_reader_clusters(p_limit int default 6)
returns table (cluster_id int, label text, affinity int, riempibili int)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select b.cluster_id, c.label, count(*)::int,
         (select count(*)::int from public.books x
           where x.cluster_id = b.cluster_id
             and x.cover_url is not null
             and not exists (select 1 from public.user_books ub2
                             where ub2.user_id = auth.uid() and ub2.book_id = x.id))
  from public.user_books ub
  join public.books b on b.id = ub.book_id
  join public.book_clusters c on c.id = b.cluster_id
  where ub.user_id = auth.uid()
    and (ub.liked or ub.status = 'read' or coalesce(ub.rating, 0) >= 4)
    and c.label is not null
  group by b.cluster_id, c.label
  order by count(*) desc, b.cluster_id
  limit greatest(p_limit, 0);
$$;
grant execute on function public.get_reader_clusters(int) to authenticated;

-- L'indice parziale ora copre 8.402 righe invece di 69.061: si rifà le
-- statistiche, perché il planner ne ha di vecchie su una tabella molto diversa.
analyze public.books;

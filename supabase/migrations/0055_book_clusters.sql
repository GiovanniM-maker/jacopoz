-- =====================================================================
-- 0055 — filoni: raggruppare i libri per come sono, non per come sono
--        catalogati
--
-- Il catalogo ha 68.737 libri distribuiti su **19 categorie**: circa 3.600 libri
-- per etichetta. "Saggistica" e "Narrativa" non sono filoni, sono scaffali. Una
-- sezione della Home che dice "Il tuo filone: Narrativa" non dice niente.
--
-- Gli embedding però ci sono già, per tutti e 68.737. Da lì si ricavano gruppi
-- che *emergono dai libri* invece di essere decisi prima: il giallo francese
-- anni Cinquanta sta insieme, il dark romance italiano sta insieme, e nessuno
-- dei due è una voce di tassonomia.
--
-- Metodo: k-means, con l'inizializzazione sparsa (farthest-point, la stessa
-- idea di k-means++) perché seminare a caso su un catalogo sbilanciato produce
-- venti cluster di narrativa e uno di tutto il resto.
--
-- Costo misurato prima di scrivere il resto: assegnare 1.000 libri a 120 semi
-- costa 52 ms, cioè **~4 secondi per l'intero catalogo** per iterazione. Con
-- halfvec i centroidi stanno in cache e il conto è banale; era il presupposto
-- di tutto, e senza quel numero questa migrazione non avrebbe senso.
-- =====================================================================

create table if not exists public.book_clusters (
  id          int primary key,
  label       text,
  centroid    extensions.vector(512),
  size        int not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.book_clusters enable row level security;
drop policy if exists book_clusters_read on public.book_clusters;
create policy book_clusters_read on public.book_clusters for select
  to authenticated, anon using (true);

alter table public.books add column if not exists cluster_id int
  references public.book_clusters(id) on delete set null;
create index if not exists books_cluster_idx on public.books (cluster_id)
  where cluster_id is not null;

-- --------------------------------------------------------------------
-- Semina: farthest-point su un campione
-- --------------------------------------------------------------------
/**
 * Sceglie `p_k` libri il più lontani possibile fra loro, partendo da un
 * campione di candidati decenti (copertina e almeno un segnale di lettura o di
 * giudizio: un libro senza copertina non deve dare il nome a un filone).
 *
 * Seminare a caso non funziona su un catalogo sbilanciato: il 60% è narrativa
 * generica, e semi casuali producono venti cluster quasi identici. Prendere ogni
 * volta il candidato più lontano da tutti i semi già scelti costringe la semina
 * a coprire anche le zone rade — che sono proprio le nicchie che ci interessano.
 */
create or replace function public.internal_seed_clusters(p_k int default 200)
returns int
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_added int := 0;
begin
  -- `on commit drop` libera la tabella al commit, non alla fine della
  -- funzione: due chiamate nella stessa transazione si scontrano. È già
  -- successo — tre iterazioni in un colpo solo sono girate dieci minuti e poi
  -- sono morte su "relation already exists", buttando via tutto il lavoro.
  drop table if exists _cand;
  create temp table _cand on commit drop as
    select b.id, b.embedding::extensions.halfvec(512) as e
    from public.books b
    where b.embedding is not null
      and b.cover_url is not null
      and (b.reads_count + b.likes_count + coalesce(b.external_ratings_count, 0)) > 0
    order by md5(b.id::text || 'seed')
    limit 6000;

  drop table if exists _seed;
  create temp table _seed (id uuid primary key, e extensions.halfvec(512)) on commit drop;
  insert into _seed select c.id, c.e from _cand c limit 1;

  while v_added < p_k - 1 loop
    insert into _seed
    select c.id, c.e
    from _cand c
    where not exists (select 1 from _seed s where s.id = c.id)
    order by (select min(c.e <=> s.e) from _seed s) desc
    limit 1;
    exit when not found;
    v_added := v_added + 1;
  end loop;

  delete from public.book_clusters;
  insert into public.book_clusters (id, centroid, size)
  select row_number() over (order by s.id), s.e::extensions.vector(512), 0
  from _seed s;

  return (select count(*)::int from public.book_clusters);
end;
$$;
revoke execute on function public.internal_seed_clusters(int) from public, anon, authenticated;

-- --------------------------------------------------------------------
-- Un giro di k-means: assegna tutti, poi ricalcola i centroidi
-- --------------------------------------------------------------------
create or replace function public.internal_cluster_iterate()
returns int
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_moved int;
begin
  drop table if exists _cent;
  create temp table _cent on commit drop as
    select c.id, c.centroid::extensions.halfvec(512) as e from public.book_clusters c;
  create index on _cent (id);

  with assegnati as (
    select b.id,
           (select c.id from _cent c
             order by c.e <=> (b.embedding::extensions.halfvec(512)) limit 1) as cl
    from public.books b
    where b.embedding is not null
  ),
  cambiati as (
    update public.books b set cluster_id = a.cl
    from assegnati a
    where b.id = a.id and b.cluster_id is distinct from a.cl
    returning 1
  )
  select count(*)::int into v_moved from cambiati;

  -- Centroidi nuovi. avg() lavora su `vector`, non su halfvec, quindi la media
  -- si fa a piena precisione e si accorcia solo al confronto.
  update public.book_clusters c
  set centroid = agg.m, size = agg.n, updated_at = now()
  from (
    select b.cluster_id cl, avg(b.embedding) m, count(*)::int n
    from public.books b
    where b.cluster_id is not null and b.embedding is not null
    group by b.cluster_id
  ) agg
  where c.id = agg.cl;

  -- Un cluster rimasto senza libri non serve a niente e sporca le etichette.
  delete from public.book_clusters where size = 0;

  return v_moved;
end;
$$;
revoke execute on function public.internal_cluster_iterate() from public, anon, authenticated;

-- --------------------------------------------------------------------
-- Etichette ricavate dal contenuto
-- --------------------------------------------------------------------
/**
 * Il nome di un filone si deduce da cosa c'è dentro, non si inventa.
 *
 * Due segnali: il genere prevalente (col nome italiano di `genres`) e l'autore
 * **sovra-rappresentato** — non il più frequente in assoluto, che sarebbe
 * sempre lo stesso nome popolare, ma quello che in questo gruppo pesa molto più
 * che nel catalogo intero. È la differenza fra "Narrativa" e "Narrativa ·
 * attorno a Georges Simenon".
 */
create or replace function public.internal_label_clusters()
returns int
language sql
volatile
security definer
set search_path = public, extensions
as $$
  with per_cluster as (
    select b.cluster_id cl, b.id, b.categories, b.authors
    from public.books b where b.cluster_id is not null
  ),
  genere as (
    select cl, (array_agg(c order by n desc))[1] as top
    from (
      select p.cl, cat as c, count(*) n
      from per_cluster p, unnest(p.categories) cat
      group by 1, 2
    ) z group by cl
  ),
  autore_globale as (
    select a, count(*)::numeric n
    from public.books b, unnest(b.authors) a
    group by a
  ),
  autore as (
    select cl, (array_agg(a order by score desc))[1] as top
    from (
      select p.cl, a, count(*) k,
             -- peso nel gruppo contro peso nel catalogo
             count(*)::numeric / greatest((select g.n from autore_globale g where g.a = a), 1) as score
      from per_cluster p, unnest(p.authors) a
      group by p.cl, a
      having count(*) >= 4
    ) z
    where score >= 0.5
    group by cl
  ),
  etichette as (
    select c.id,
           trim(coalesce(public.genre_label(g.top), 'Da scoprire')
                || coalesce(' · attorno a ' || au.top, '')) as label
    from public.book_clusters c
    left join genere g on g.cl = c.id
    left join autore au on au.cl = c.id
  ),
  scritte as (
    update public.book_clusters c set label = e.label
    from etichette e where e.id = c.id
    returning 1
  )
  select count(*)::int from scritte;
$$;
revoke execute on function public.internal_label_clusters() from public, anon, authenticated;

-- --------------------------------------------------------------------
-- Lettura
-- --------------------------------------------------------------------
/** I libri di un filone, i migliori per primi, senza quelli già sullo scaffale
 *  del lettore. */
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
  order by (coalesce(b.external_rating, 0) * ln(2 + coalesce(b.external_ratings_count, 0))
            + (b.reads_count + b.likes_count))
           * (0.6 + (abs(hashtext(b.id::text || ':' || p_seed::text)) % 1000)::numeric / 1000) desc
  limit greatest(p_limit, 0);
$$;
grant execute on function public.get_cluster_books(int, int, int) to authenticated, anon;

/** I filoni del lettore: quelli in cui cadono i libri che ha amato, i più
 *  presenti per primi. È questo che rende una sezione "sua" invece che
 *  "di tutti". */
create or replace function public.get_reader_clusters(p_limit int default 6)
returns table (cluster_id int, label text, affinity int)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select b.cluster_id, c.label, count(*)::int
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

-- I libri nuovi arrivano senza filone: assegnarli è un confronto con ~200
-- centroidi, cioè niente.
create or replace function public.internal_cluster_new_books(p_batch int default 500)
returns int
language plpgsql
volatile
security definer
set search_path = public, extensions
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
    where b.cluster_id is null and b.embedding is not null
    limit greatest(p_batch, 1)
  ),
  fatti as (
    update public.books b
    set cluster_id = (select c.id from _c c order by c.e <=> d.e limit 1)
    from da_fare d where b.id = d.id
    returning 1
  )
  select count(*)::int into v_n from fatti;
  return v_n;
end;
$$;
revoke execute on function public.internal_cluster_new_books(int) from public, anon, authenticated;

select cron.schedule(
  'cluster-new-books', '*/10 * * * *',
  $$select public.internal_cluster_new_books(500)$$
);

-- --------------------------------------------------------------------
-- Il costruttore: un passo per volta
-- --------------------------------------------------------------------
/**
 * Una passata di k-means su questo catalogo costa ~10 minuti sull'istanza
 * Micro: 68.737 libri contro 200 centroidi sono 13,7 milioni di confronti a 512
 * dimensioni, più la riscrittura delle righe che hanno cambiato gruppo.
 *
 * Quindi **un passo per esecuzione**, non tre in una transazione: una
 * transazione lunga trenta minuti è un rischio inutile, e se salta all'ultimo
 * passo si perde anche il primo. Lo stato sta in `app_config` così il cron può
 * riprendere da dove era.
 */
create or replace function public.internal_cluster_step()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_step int := coalesce((select (value #>> '{}')::int from public.app_config
                          where key = 'cluster_build_step'), 0);
  v_moved int;
begin
  if v_step >= 3 then
    perform public.internal_label_clusters();
    delete from public.app_config where key = 'cluster_build_step';
    perform cron.unschedule('cluster-build');
    return 'etichettati e finito';
  end if;

  v_moved := public.internal_cluster_iterate();
  insert into public.app_config (key, value) values ('cluster_build_step', to_jsonb(v_step + 1))
    on conflict (key) do update set value = excluded.value;
  return format('passo %s: %s libri spostati', v_step + 1, v_moved);
end;
$$;
revoke execute on function public.internal_cluster_step() from public, anon, authenticated;

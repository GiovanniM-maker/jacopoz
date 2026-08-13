-- =====================================================================
-- 0070b — Il riempimento aveva spezzato proprio le opere che doveva unire
--
-- Verifica dopo il backfill di 0070: **68.877 work_id distinti su 68.877
-- libri**, cioè nessuna opera con più di un'edizione. Tutte e 144 quelle che
-- ne hanno spezzate, una per edizione. Il risultato era l'esatto contrario
-- dello scopo, e l'unico modo di accorgersene era contare — la funzione non
-- ha dato errore e ha riportato di aver scritto tutte le righe.
--
-- La colpa è di questa riga in `internal_backfill_work_id`:
--
--     first_value(gen_random_uuid()) over (partition by d.work_key)
--
-- L'idea era «un uuid per gruppo». Ma `gen_random_uuid()` è VOLATILE, e con una
-- funzione volatile dentro l'argomento di una finestra Postgres non garantisce
-- di valutarla una volta per partizione: di fatto ogni riga ha avuto il
-- proprio. Un costrutto che *sembra* dire «uno per gruppo» e non lo dice.
--
-- La correzione tocca 298 righe, non 68.877: gli id delle opere a edizione
-- unica sono giusti così come sono. Per le altre si tiene il minimo del gruppo,
-- che è una scelta deterministica e non ne conia di nuovi.
-- =====================================================================

with da_unire as (
  select work_key, min(work_id::text)::uuid as wid
  from public.books
  where work_key is not null
  group by work_key
  having count(distinct work_id) > 1
)
update public.books b
   set work_id = d.wid
  from da_unire d
 where b.work_key = d.work_key;

-- --------------------------------------------------------------------
-- E la funzione, perché non lo rifaccia
-- --------------------------------------------------------------------
-- Niente più funzioni volatili dentro una finestra: l'uuid del gruppo si
-- ricava in modo **deterministico** dalla chiave. Due edizioni con la stessa
-- work_key ottengono lo stesso valore per costruzione, in qualunque lotto
-- cadano e in qualunque ordine.
--
-- Derivarlo da work_key non contraddice il motivo per cui work_id esiste:
-- serve solo ad assegnare il valore iniziale. Da lì in poi è il trigger a
-- decidere, e un libro che cambia titolo si tiene il suo work_id invece di
-- seguirne la chiave — che è esattamente la stabilità che volevamo.
create or replace function public.internal_backfill_work_id(p_batch int default 3000)
returns int
language sql
volatile
security definer
set search_path = public, extensions
as $$
  with da_fare as (
    select b.id, b.work_key
    from public.books b
    where b.work_id is null
    limit greatest(p_batch, 1)
  ),
  assegnate as (
    select d.id,
      coalesce(
        -- Se una sorella è già stata riempita, si usa la sua identità.
        (select b2.work_id from public.books b2
          where b2.work_key = d.work_key and b2.work_id is not null limit 1),
        -- Altrimenti un valore che dipende solo dalla chiave.
        case when d.work_key is not null
             then md5(d.work_key)::uuid
             else d.id end
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

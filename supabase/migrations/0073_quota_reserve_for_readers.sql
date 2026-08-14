-- =====================================================================
-- 0073 — La quota è una sola, e i lettori vengono prima del backfill
--
-- Misurata, non più supposta: **1.000 chiamate al giorno**. Oggi il contatore
-- si è fermato a 1.002 e ha toccato il muro alle 11:10 UTC.
--
-- Il problema non è il muro. È che `ingest-book` — la funzione che importa un
-- libro quando un lettore lo cerca e non c'è — **usa la stessa chiave**. Con il
-- lotto alzato a 30 ogni 5 minuti, il backfill si è mangiato tutte e mille le
-- chiamate entro le 13:10 italiane. Da quel momento fino alle 9 del mattino
-- dopo, chi cercava un libro assente dal catalogo non otteneva niente da
-- Google Books.
--
-- È una regressione che ho introdotto io ieri alzando il ritmo, e riguarda
-- la funzione da cui è partito tutto questo lavoro: «i miei amici non trovano
-- i libri».
--
-- Quindi il backfill non è più libero di consumare la quota: ne ha una parte,
-- e il resto resta ai lettori.
--
--   riserva lettori   400 chiamate
--   tetto backfill    600 chiamate  → ~375 libri al giorno a 1,6 chiamate l'uno
--
-- E il lotto scende da 30 ogni 5 minuti a 4 ogni 15: 384 libri al giorno,
-- distribuiti su tutte le 24 ore invece di bruciati entro mezzogiorno. Il
-- catalogo dei libri che contano si copre comunque — l'ordinamento per
-- priorità fa sì che i primi siano quelli che qualcuno ha davvero aperto.
-- =====================================================================

create or replace function public.internal_blurb_dispatch()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_anon   text;
  -- Quanto il backfill può consumare in un giorno Google. Il resto è dei
  -- lettori: `ingest-book` attinge alla stessa quota, e una ricerca che non
  -- trova il libro è un danno immediato e visibile, mentre una descrizione
  -- che arriva domani non la nota nessuno.
  c_tetto  constant int := 600;
begin
  -- Muro già toccato oggi, o tetto del backfill raggiunto.
  if exists (
    select 1 from public.blurb_quota
    where giorno = (now() at time zone 'America/Los_Angeles')::date
      and (esaurita_alle is not null or chiamate >= c_tetto)
  ) then
    return;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'synopsis_dispatch_secret';
  select decrypted_secret into v_anon
  from vault.decrypted_secrets where name = 'anon_key';
  if v_secret is null or v_anon is null then return; end if;

  perform net.http_post(
    url     := 'https://tpphaalfmcqtfxhyafzz.supabase.co/functions/v1/blurbs',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_anon,
                 'x-dispatch-secret', v_secret),
    body    := jsonb_build_object('batch', 4),
    timeout_milliseconds := 120000
  );
end;
$$;
revoke execute on function public.internal_blurb_dispatch() from public, anon, authenticated;

select cron.unschedule('blurb-backfill');
select cron.schedule('blurb-backfill', '*/15 * * * *',
  $$select public.internal_blurb_dispatch()$$);

-- --------------------------------------------------------------------
-- Un lavoro che non ha più niente da fare non deve svegliarsi ogni 5 minuti
-- --------------------------------------------------------------------
-- `stamp-embedding-hash` serviva a marcare le righe storiche: misurato adesso,
-- ne restano **zero**. Da 0061 l'impronta si scrive nella stessa UPDATE del
-- vettore, quindi questo cron è solo una rete di sicurezza. Su un'istanza Micro
-- con nove lavori sotto i cinque minuti, una rete di sicurezza può girare
-- una volta l'ora.
select cron.unschedule('stamp-embedding-hash');
select cron.schedule('stamp-embedding-hash', '23 * * * *',
  $$select public.internal_stamp_embedding_hash(4000)$$);

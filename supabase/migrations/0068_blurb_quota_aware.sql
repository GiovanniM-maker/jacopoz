-- =====================================================================
-- 0068 — Lotto più grande, con un freno che impara dov'è il muro
--
-- Il ritmo di 0064 (8 libri ogni 20 minuti) era tarato per stare sotto una
-- quota che non conosco: la documentazione pubblica di Google Books non la
-- dichiara, si legge solo dalla console del progetto. Tarare a occhio verso il
-- basso costa mesi di copertura; tarare verso l'alto senza rete costa un muro
-- di 429 per il resto della giornata.
--
-- Quindi: lotto alzato a 30 libri ogni 5 minuti (~360 libri l'ora, il catalogo
-- coperto in circa otto giorni invece di quattro mesi), e un contatore che
-- registra quante chiamate sono state fatte e se si è arrivati al limite. Al
-- primo 429 la giornata si chiude da sola e riprende il giorno dopo.
--
-- Il "giorno" è quello di Google, non il nostro: le quote giornaliere di Cloud
-- si azzerano a mezzanotte del Pacifico. Contarle sul giorno italiano
-- spezzerebbe ogni conteggio a metà.
--
-- Effetto collaterale utile: dopo ventiquattr'ore la tabella dice qual è la
-- quota vera, misurata invece che supposta.
-- =====================================================================

create table if not exists public.blurb_quota (
  giorno        date primary key,
  chiamate      int not null default 0,
  libri         int not null default 0,
  esaurita_alle timestamptz
);

comment on table public.blurb_quota is
  'Consumo giornaliero dell''API Google Books, sul giorno del Pacifico — è a '
  'mezzanotte PT che Cloud azzera le quote. Serve a fermarsi da soli quando '
  'si tocca il limite, e a scoprire qual è.';

-- Nessun lettore ha motivo di vedere questa tabella.
alter table public.blurb_quota enable row level security;
revoke all on table public.blurb_quota from anon, authenticated;

create or replace function public.internal_blurb_quota_report(
  p_chiamate int, p_libri int, p_esaurita boolean
) returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.blurb_quota as q (giorno, chiamate, libri, esaurita_alle)
  values (
    (now() at time zone 'America/Los_Angeles')::date,
    greatest(p_chiamate, 0), greatest(p_libri, 0),
    case when p_esaurita then now() end
  )
  on conflict (giorno) do update
    set chiamate      = q.chiamate + excluded.chiamate,
        libri         = q.libri + excluded.libri,
        -- Il primo muro della giornata è quello che conta: sovrascriverlo con
        -- i tentativi successivi perderebbe l'informazione di quando è caduto.
        esaurita_alle = coalesce(q.esaurita_alle, excluded.esaurita_alle);
$$;
revoke execute on function public.internal_blurb_quota_report(int, int, boolean) from public, anon, authenticated;
grant execute on function public.internal_blurb_quota_report(int, int, boolean) to service_role;

-- --------------------------------------------------------------------
-- Il dispatch si ferma da solo per il resto della giornata
-- --------------------------------------------------------------------
create or replace function public.internal_blurb_dispatch()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_anon   text;
begin
  -- Se oggi si è già toccato il limite, non ha senso svegliare la funzione
  -- ogni cinque minuti per farle prendere un altro 429.
  if exists (
    select 1 from public.blurb_quota
    where giorno = (now() at time zone 'America/Los_Angeles')::date
      and esaurita_alle is not null
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
    body    := jsonb_build_object('batch', 30),
    timeout_milliseconds := 240000
  );
end;
$$;
revoke execute on function public.internal_blurb_dispatch() from public, anon, authenticated;

select cron.unschedule('blurb-backfill');
select cron.schedule('blurb-backfill', '*/5 * * * *',
  $$select public.internal_blurb_dispatch()$$);

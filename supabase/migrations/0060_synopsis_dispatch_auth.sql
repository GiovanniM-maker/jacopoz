-- =====================================================================
-- 0060 — il cron delle sinossi non arrivava alla funzione
--
-- `internal_synopsis_dispatch` mandava solo `x-dispatch-secret`, ma il gateway
-- delle Edge Function con `verify_jwt = true` rifiuta prima ancora di eseguire
-- il codice: 401 UNAUTHORIZED_NO_AUTH_HEADER, due volte, senza che nulla nel
-- cron sembrasse fallito — `cron.job_run_details` diceva "succeeded / 1 row",
-- che è l'id della richiesta HTTP, non il suo esito. Le risposte vere stanno in
-- `net._http_response`, ed è lì che si vedeva.
--
-- La funzione gemella (send-push) risolve disattivando `verify_jwt` e
-- difendendosi da sola. Qui si tengono i due strati: il gateway verifica un
-- token, il codice verifica il segreto. La chiave anon è pubblica per
-- costruzione — sta già nel bundle web — quindi usarla qui non espone niente,
-- ma passa dal Vault invece che scritta in chiaro nel corpo della funzione.
-- =====================================================================

create or replace function public.internal_synopsis_dispatch()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_anon   text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'synopsis_dispatch_secret';
  select decrypted_secret into v_anon
  from vault.decrypted_secrets where name = 'anon_key';
  if v_secret is null or v_anon is null then return; end if;

  perform net.http_post(
    url     := 'https://tpphaalfmcqtfxhyafzz.supabase.co/functions/v1/synopsis',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_anon,
                 'x-dispatch-secret', v_secret),
    body    := jsonb_build_object('batch', 20),
    timeout_milliseconds := 150000
  );
end;
$$;
revoke execute on function public.internal_synopsis_dispatch() from public, anon, authenticated;

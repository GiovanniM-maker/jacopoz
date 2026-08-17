-- =====================================================================
-- 0062 — La coda delle sinossi deve ricordarsi dei rifiuti
--
-- Il difetto, visto in produzione: il modello risponde INSUFFICIENTE per i
-- libri di cui abbiamo solo titolo, autore e categoria — ed è la risposta
-- giusta, meglio una scheda vuota che una inventata. Ma la coda ordina per
-- priorità e non sa niente di quel rifiuto, quindi quegli stessi libri
-- ritornano in testa a ogni giro. Misurato: quattro dei venti libri di ogni
-- lotto erano chiamate già note come perdenti.
--
-- Non è solo spreco. I rifiuti si accumulano in testa a ciascuna fascia di
-- priorità: prima o poi il lotto è fatto **solo** di rifiuti, il backfill
-- smette di avanzare, e cron continua a segnare "succeeded". È lo stesso modo
-- di fallire — in silenzio, con tutti i semafori verdi — che ho già dovuto
-- correggere due volte in questa pipeline.
--
-- La regola: un tentativo fallito si scrive. Dopo due, il libro esce dalla
-- coda finché non arriva materiale nuovo.
-- =====================================================================

alter table public.books
  add column if not exists synopsis_attempts int not null default 0,
  add column if not exists synopsis_last_attempt timestamptz,
  add column if not exists synopsis_skip_reason text;

comment on column public.books.synopsis_attempts is
  'Tentativi di generazione andati a vuoto. A 2 il libro esce dalla coda: '
  'con gli stessi materiali il modello darà la stessa risposta.';
comment on column public.books.synopsis_skip_reason is
  'Perché l''ultimo tentativo non ha prodotto niente. Distingue "materiali '
  'insufficienti" (colpa del catalogo) da un errore di rete o di chiave.';

-- Il conteggio lo tiene il database, non il client: due lotti sovrapposti che
-- leggono, incrementano e riscrivono perderebbero un tentativo per strada.
create or replace function public.internal_synopsis_attempt_failed(
  p_book_id uuid, p_motivo text
) returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.books
     set synopsis_attempts    = synopsis_attempts + 1,
         synopsis_last_attempt = now(),
         synopsis_skip_reason  = left(p_motivo, 200)
   where id = p_book_id;
$$;
revoke execute on function public.internal_synopsis_attempt_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.internal_synopsis_attempt_failed(uuid, text) to service_role;

-- --------------------------------------------------------------------
-- La coda, con il filtro
-- --------------------------------------------------------------------
create or replace function public.internal_synopsis_queue(p_limit int default 20)
returns table (id uuid, title text, authors text[], priorita int)
language sql
stable
security definer
set search_path = public, extensions
as $$
  -- I due segnali si aggregano **prima**: sono tabelle piccole (995 eventi,
  -- poche centinaia di scaffali). La prima versione li cercava con due lateral
  -- correlate per ciascuno dei 68.817 libri e superava gli 8 secondi di
  -- statement_timeout di PostgREST — passava solo dall'API di gestione, che ha
  -- un limite più lungo, quindi in prova sembrava funzionare.
  with visti as (
    -- Il client scrive `bookId`, non `book_id`: leggerne una sola avrebbe reso
    -- il segnale più importante della coda — i libri che qualcuno ha davvero
    -- aperto — invisibile, senza che niente andasse in errore.
    select coalesce(e.props ->> 'bookId', e.props ->> 'book_id')::uuid as bid, count(*)::int n
    from public.analytics_events e
    where coalesce(e.props ->> 'bookId', e.props ->> 'book_id') ~ '^[0-9a-f-]{36}$'
    group by 1
  ),
  scaffale as (
    select ub.book_id as bid, count(*)::int n
    from public.user_books ub group by 1
  )
  select b.id, b.title, b.authors,
    (coalesce(case when v.n > 0 then 1000 + least(v.n, 500) else 0 end, 0)
     + coalesce(case when s.n > 0 then 500 + least(s.n * 50, 400) else 0 end, 0)
     + case when b.cover_url is not null then 50 else 0 end
     + least((b.reads_count + b.saves_count + b.likes_count + b.reviews_count) * 5, 200)
     + least(round(coalesce(b.external_rating, 0) * 10)::int, 50)
     -- Un tentativo già andato a vuoto scende in fondo alla sua fascia: si
     -- riprova, ma solo quando non c'è di meglio da fare.
     - b.synopsis_attempts * 300
    ) as priorita
  from public.books b
  left join visti v on v.bid = b.id
  left join scaffale s on s.bid = b.id
  where b.synopsis is null
    and b.synopsis_attempts < 2
  order by priorita desc, b.id
  limit greatest(p_limit, 0);
$$;
revoke execute on function public.internal_synopsis_queue(int) from public, anon, authenticated;
grant execute on function public.internal_synopsis_queue(int) to service_role;

-- --------------------------------------------------------------------
-- Materiale nuovo azzera i tentativi
-- --------------------------------------------------------------------
-- Un libro escluso per mancanza di materiali non deve restare escluso per
-- sempre: l'arricchimento gli porterà una quarta di copertina, e a quel punto
-- la domanda al modello è diversa da quella a cui aveva risposto di no.
create or replace function public.internal_reset_synopsis_attempts()
returns trigger
language plpgsql
as $$
begin
  if new.source_blurb_internal is distinct from old.source_blurb_internal
     and new.source_blurb_internal is not null then
    new.synopsis_attempts   := 0;
    new.synopsis_skip_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists books_reset_synopsis_attempts on public.books;
create trigger books_reset_synopsis_attempts
  before update of source_blurb_internal on public.books
  for each row execute function public.internal_reset_synopsis_attempts();

-- --------------------------------------------------------------------
-- I rifiuti già noti
-- --------------------------------------------------------------------
-- Quattro libri hanno già ricevuto due risposte INSUFFICIENTE ciascuno prima
-- che questa colonna esistesse. Segnarli adesso evita altri giri a vuoto.
update public.books
   set synopsis_attempts = 2,
       synopsis_skip_reason = 'materiali insufficienti',
       synopsis_last_attempt = now()
 where synopsis is null
   and source_blurb_internal is null
   and title in ('La vegetariana', 'A supposedly fun thing I''ll never do again',
                 'Fragments d''un discours amoureux', 'Consider the lobster, and other essays');

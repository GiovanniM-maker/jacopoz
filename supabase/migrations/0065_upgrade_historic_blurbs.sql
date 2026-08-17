-- =====================================================================
-- 0065 — Anche il materiale vecchio va sostituito, non solo quello assente
--
-- 0064 recupera le descrizioni per i libri che non ne hanno. Restano fuori i
-- ~700 che ne hanno una **storica**, presa da Wikipedia — e sono proprio quelli
-- su cui le sinossi si stanno scrivendo adesso.
--
-- Guardati uno per uno, sono di due tipi:
--
--   «L'idiota» → «Due giovani uomini, seduti l'uno di fronte all'altro, con le
--   ginocchia che si toccano, nello spazio limitato di un vagone in corsa…»
--   Questa è una quarta di copertina: dice cosa succede nel libro.
--
--   «Crime and Punishment» → «is a novel by the Russian author Fyodor
--   Dostoevsky. It was first published in the literary journal…»
--   Questo è l'incipit della voce enciclopedica: dice cos'è il libro, non cosa
--   ci succede dentro. È il caso in cui il modello, non trovando la trama nel
--   materiale, la completa con quello che ricorda del titolo — che è l'errore
--   che 0063 doveva chiudere.
--
-- Distinguere i due casi automaticamente non si può fare in modo affidabile.
-- Sostituirli tutti con la quarta di copertina dell'editore, sì: sono 700
-- libri, poco più di un giorno di quota.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. La coda prende anche chi ha materiale storico
-- --------------------------------------------------------------------
create or replace function public.internal_blurb_queue(p_limit int default 8)
returns table (id uuid, title text, authors text[], isbn_13 text, language text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with visti as (
    select coalesce(e.props ->> 'bookId', e.props ->> 'book_id')::uuid as bid, count(*)::int n
    from public.analytics_events e
    where coalesce(e.props ->> 'bookId', e.props ->> 'book_id') ~ '^[0-9a-f-]{36}$'
    group by 1
  ),
  scaffale as (
    select ub.book_id as bid, count(*)::int n
    from public.user_books ub group by 1
  )
  select b.id, b.title, b.authors, b.isbn_13, b.language
  from public.books b
  left join visti v on v.bid = b.id
  left join scaffale s on s.bid = b.id
  where b.blurb_source is null            -- mai passato da Google Books
    and b.blurb_attempts < 2
    and (b.blurb_checked_at is null or b.blurb_checked_at < now() - interval '90 days')
  order by
    (coalesce(case when v.n > 0 then 1000 + least(v.n, 500) else 0 end, 0)
     + coalesce(case when s.n > 0 then 500 + least(s.n * 50, 400) else 0 end, 0)
     + case when b.cover_url is not null then 50 else 0 end
     + least((b.reads_count + b.saves_count + b.likes_count + b.reviews_count) * 5, 200)
     + case when b.isbn_13 is not null then 30 else 0 end
     -- Prima i libri che hanno **già** materiale storico: sono quelli su cui la
     -- coda delle sinossi sta lavorando in questo momento, quindi sono gli unici
     -- che possono produrre una scheda sbagliata mentre aspettano.
     + case when length(coalesce(b.source_blurb_internal, '')) >= 100 then 400 else 0 end
     - b.blurb_attempts * 300
    ) desc, b.id
  limit greatest(p_limit, 0);
$$;
revoke execute on function public.internal_blurb_queue(int) from public, anon, authenticated;
grant execute on function public.internal_blurb_queue(int) to service_role;

-- --------------------------------------------------------------------
-- 2. Materiale migliore ⇒ la sinossi si rifà
-- --------------------------------------------------------------------
-- Senza questo, una sinossi scritta su una voce enciclopedica resterebbe lì
-- per sempre: il libro ha già `synopsis`, quindi la coda non lo guarda più, e
-- la descrizione nuova non servirebbe a niente.
--
-- Vale solo per le sinossi generate: se un giorno arrivasse una sinossi
-- dell'editore (`synopsis_source = 'publisher'`) non è nostra e non si tocca.
create or replace function public.internal_reset_synopsis_attempts()
returns trigger
language plpgsql
as $$
begin
  if new.source_blurb_internal is distinct from old.source_blurb_internal
     and new.source_blurb_internal is not null then
    new.synopsis_attempts    := 0;
    new.synopsis_skip_reason := null;

    if old.synopsis is not null and old.synopsis_source = 'ai' then
      new.synopsis                := null;
      new.synopsis_source         := null;
      new.synopsis_model          := null;
      new.synopsis_prompt_version := null;
      new.synopsis_generated_at   := null;
      new.synopsis_inputs         := null;
    end if;
  end if;
  return new;
end;
$$;

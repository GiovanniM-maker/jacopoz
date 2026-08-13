-- =====================================================================
-- 0071 — W1b, seconda metà: le recensioni si agganciano all'opera
--
-- 0070 ha dato a ogni edizione l'identità della sua opera (`books.work_id`),
-- riempita a lotti perché l'aggiornamento tocca l'indice HNSW.
-- Qui si sposta il punto di attacco delle recensioni e si cambiano le due
-- letture che le mostrano.
-- =====================================================================

alter table public.books alter column work_id set not null;

alter table public.reviews add column if not exists work_id uuid;

update public.reviews r
   set work_id = b.work_id
  from public.books b
 where b.id = r.book_id and r.work_id is null;

alter table public.reviews alter column work_id set not null;

-- Lo scrive il database, non chi chiama: se lo mettesse il client, una riga
-- scritta da uno script futuro potrebbe agganciarsi all'opera sbagliata, e il
-- vincolo qui sotto non se ne accorgerebbe.
create or replace function public.tg_reviews_work_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select b.work_id into new.work_id from public.books b where b.id = new.book_id;
  return new;
end;
$$;
revoke execute on function public.tg_reviews_work_id() from public, anon, authenticated;

drop trigger if exists reviews_set_work_id on public.reviews;
create trigger reviews_set_work_id
  before insert or update of book_id on public.reviews
  for each row execute function public.tg_reviews_work_id();

-- Una recensione per lettore per **opera**, non per edizione. Verificato prima
-- di metterlo: nessuna coppia (utente, opera) è oggi duplicata.
create unique index if not exists reviews_user_work_key on public.reviews (user_id, work_id);
create index if not exists reviews_work_idx on public.reviews (work_id)
  where status = 'visible';

-- --------------------------------------------------------------------
-- Il contatore vale per l'opera, su tutte le sue edizioni
-- --------------------------------------------------------------------
-- Senza questo l'edizione Adelphi direbbe «3 recensioni» e l'Einaudi «nessuna»
-- pur mostrando le stesse tre. Si ricalcola invece di incrementare: le opere
-- con più edizioni sono 144, e il conteggio esatto costa meno del ragionamento
-- su cosa incrementare e su quale riga.
create or replace function public.reviews_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_work uuid := coalesce(new.work_id, old.work_id);
begin
  update public.books b
     set reviews_count = (
       select count(*) from public.reviews r
       where r.work_id = b.work_id and r.status = 'visible')
   where b.work_id = v_work;
  return null;
end;
$$;
revoke execute on function public.reviews_after_change() from public, anon, authenticated;

-- Riallineamento una tantum: i contatori esistenti sono per edizione.
update public.books b
   set reviews_count = (
     select count(*) from public.reviews r
     where r.work_id = b.work_id and r.status = 'visible')
 where b.work_id in (select work_id from public.reviews);

-- --------------------------------------------------------------------
-- Scrivere e leggere la propria recensione
-- --------------------------------------------------------------------
-- Il client faceva `upsert ... on conflict (user_id, book_id)`. Con il vincolo
-- sull'opera quella chiamata sbaglia proprio nel caso che stiamo sistemando:
-- chi ha recensito l'Einaudi e apre l'Adelphi non trova conflitto, tenta un
-- INSERT, e riceve un errore di vincolo invece di modificare la sua
-- recensione. La regola «una per opera» sta qui, in un posto solo.
create or replace function public.upsert_review(
  p_book_id uuid,
  p_body text,
  p_rating smallint default null,
  p_spoilers boolean default false
) returns public.reviews
language plpgsql
security invoker            -- le policy RLS di `reviews` restano quelle che decidono
set search_path = public
as $$
declare
  v_work uuid;
  v_esistente uuid;
  v_out public.reviews;
begin
  select b.work_id into v_work from public.books b where b.id = p_book_id;
  if v_work is null then
    raise exception 'libro inesistente';
  end if;

  select r.id into v_esistente
  from public.reviews r
  where r.user_id = auth.uid() and r.work_id = v_work;

  if v_esistente is not null then
    -- Si aggiorna anche `book_id`: se il lettore sta scrivendo dall'edizione
    -- che ha davvero in mano, è quella che va registrata.
    update public.reviews
       set body = p_body, rating = p_rating,
           contains_spoilers = coalesce(p_spoilers, false),
           book_id = p_book_id
     where id = v_esistente
    returning * into v_out;
  else
    insert into public.reviews (user_id, book_id, body, rating, contains_spoilers)
    values (auth.uid(), p_book_id, p_body, p_rating, coalesce(p_spoilers, false))
    returning * into v_out;
  end if;

  return v_out;
end;
$$;
grant execute on function public.upsert_review(uuid, text, smallint, boolean) to authenticated;

/** La recensione di chi chiama per **l'opera** a cui appartiene questo libro.
 *  Cercarla per edizione mostrerebbe un modulo vuoto a chi ha già scritto. */
create or replace function public.get_my_review(p_book_id uuid)
returns public.reviews
language sql
stable
security invoker
set search_path = public
as $$
  select r.* from public.reviews r
  join public.books b on b.id = p_book_id
  where r.user_id = auth.uid() and r.work_id = b.work_id
  limit 1;
$$;
grant execute on function public.get_my_review(uuid) to authenticated;

/** Gli id di **tutte le edizioni** delle opere che chi chiama ha già recensito.
 *
 *  Serve alla schermata «cosa recensire», che esclude i libri già fatti.
 *  Restituendo solo le edizioni recensite, un lettore che ha scritto
 *  sull'Einaudi si vedrebbe riproporre l'Adelphi dello stesso libro.
 *
 *  Sta in una funzione e non in una query del client perché `books.work_id`
 *  non è fra le colonne concesse ai lettori (0059): la lista si può calcolare,
 *  la colonna non si può leggere. */
create or replace function public.get_reviewed_book_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.id from public.books b
  where b.work_id in (select r.work_id from public.reviews r where r.user_id = auth.uid());
$$;
revoke execute on function public.get_reviewed_book_ids() from public, anon;
grant execute on function public.get_reviewed_book_ids() to authenticated;

-- =====================================================================
-- 0053 — correggere le lingue palesemente sbagliate (con parsimonia)
--
-- Rendere netto il filtro lingua (0051) ha portato a galla un problema che
-- prima era invisibile: alcuni libri italiani sono in catalogo dichiarati `en`.
-- "Accabadora" di Michela Murgia e "Dialoghi con Leucò" di Pavese sono due.
-- Col filtro morbido salivano comunque; col filtro netto spariscono.
--
-- La tentazione è dedurre la lingua dal titolo. Un primo tentativo con una
-- lista di parole italiane ne pescava 38 — ma fra queste "Lonesome **Dove**",
-- "**Non**-fiction books" e "Serpent and **Dove**": marcatori come `dove`,
-- `non`, `tra` sono parole inglesi. Dichiarare italiano un libro inglese
-- rimetterebbe risultati inglesi dentro il filtro italiano, cioè esattamente il
-- difetto che stiamo correggendo. Meglio poche correzioni certe che molte
-- probabili.
--
-- La regola qui sotto chiede **due marcatori italiani distinti** e **nessuna
-- parola funzionale inglese**. Su questo catalogo tocca 4 libri, tutti
-- effettivamente italiani. La copertura è bassa per scelta.
--
-- Restano fuori i casi senza appiglio nel titolo ("Accabadora" è una parola
-- sarda, "Dialoghi con Leucò" ha un solo marcatore). Quelli si sistemano solo
-- con un riconoscimento di lingua sulla descrizione al momento dell'import:
-- annotato in docs/SPECIFICA.md come limite noto, non risolto qui.
-- =====================================================================

create or replace function public.internal_fix_obvious_language()
returns int
language sql
volatile
security definer
set search_path = public, extensions
as $$
  with strong as (
    select b.id,
      (select count(distinct m) from unnest(array[
         'della','delle','degli','dei','nella','nello','sulla','dalla','perche','piu',
         'citta','cosi','nostro','nostra','questa','questo','quando','senza','soltanto',
         'gli','che','gia','anche','ancora','sempre','tutti','tutte','mio','mia','suo','sua'
      ]) m
       where lower(public.immutable_unaccent(b.title)) ~ ('(^|[^a-z])' || m || '([^a-z]|$)')) as it_marks,
      (select count(distinct e) from unnest(array[
         'the','of','and','with','from','this','that','their','which','into','new',
         'english','translation'
      ]) e
       where lower(b.title) ~ ('(^|[^a-z])' || e || '([^a-z]|$)')) as en_marks
    from public.books b
    where b.language is distinct from 'it'
  ),
  fixed as (
    update public.books b set language = 'it'
    from strong s
    where s.id = b.id and s.it_marks >= 2 and s.en_marks = 0
    returning 1
  )
  select count(*)::int from fixed;
$$;
revoke execute on function public.internal_fix_obvious_language() from public, anon, authenticated;

select public.internal_fix_obvious_language();

-- I libri arrivano di continuo dai provider, quindi la correzione va rifatta.
select cron.schedule(
  'fix-obvious-language', '25 4 * * *',
  $$select public.internal_fix_obvious_language()$$
);

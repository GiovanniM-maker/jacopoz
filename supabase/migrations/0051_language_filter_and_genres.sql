-- =====================================================================
-- 0051 — il filtro lingua deve filtrare, e i generi vanno cercabili
--
-- Due difetti segnalati leggendo docs/SPECIFICA.md contro il comportamento
-- reale (scripts/spec-test.py, controlli L-1, L-2, L-6, G-1..G-5).
--
-- 1. LINGUA. `p_lang` era solo un *bonus di ranking*: selezionando "Italiano"
--    i risultati in italiano salivano in cima, ma tutti gli altri restavano
--    lì sotto. Su "romance" 28 risultati su 30 non erano in italiano. I quattro
--    chip però non chiedono la stessa cosa, e il testo lo dice:
--
--      "La mia lingua"  -> preferenza morbida (ordina, non esclude)
--      "Italiano"       -> filtro netto
--      "Inglese"        -> filtro netto
--      "Tutte"          -> niente filtro, niente preferenza
--
--    Il filtro va applicato **dentro i rami candidati**, non dopo: filtrare a
--    valle vorrebbe dire pescare 400 candidati per tenerne tre.
--
--    I libri senza lingua nota restano visibili in modalità morbida e in
--    "Tutte", e sono esclusi dai filtri netti — non sappiamo che lingua siano,
--    e dire "questo è in italiano" senza saperlo è esattamente il difetto che
--    stiamo correggendo.
--
-- 2. GENERI. Non erano cercabili affatto. In più i nomi erano metà in inglese
--    ("Non-fiction", "Science Fiction") in un'app italiana, e 36 generi su 51
--    non hanno un solo libro: proporli sarebbe una porta su una stanza vuota.
-- =====================================================================

-- --------------------------------------------------------------------
-- Ricerca libri con filtro lingua vero
-- --------------------------------------------------------------------
create or replace function public.search_books(
  p_query  text default '',
  p_limit  int  default 20,
  p_offset int  default 0,
  p_lang   text default null
)
returns setof public.book_card
language plpgsql
stable
security definer
set search_path = public, extensions
set pg_trgm.similarity_threshold = '0.4'
set pg_trgm.word_similarity_threshold = '0.4'
as $$
declare
  -- lower() matters: immutable_unaccent strips accents but does not fold case.
  -- The trigram and full-text operators lower-case internally so they never
  -- noticed, but position() below does not — with a raw term the relevance
  -- check found "dune" absent from "Dune Messiah", declared every query
  -- unanswered, and ran the expensive relaxed pass on all of them.
  v_term  text := lower(public.immutable_unaccent(trim(coalesce(p_query, ''))));

  -- Filtro netto: un codice di lingua esplicito, che non sia 'all'.
  v_hard  text := nullif(nullif(trim(coalesce(p_lang, '')), ''), 'all');
  -- Preferenza morbida: solo quando non è stato chiesto un filtro netto e non
  -- è stato chiesto "Tutte".
  v_pref  text := case
                    when coalesce(trim(p_lang), '') = ''
                    then coalesce(
                           (select pr.reading_language from public.profiles pr where pr.id = auth.uid()),
                           'it')
                    else null
                  end;
  -- Frammento SQL riusato da ogni ramo candidato.
  v_lang_sql text := case when v_hard is null then ''
                          else format(' and b.language = %L', v_hard) end;

  v_words    text[];
  v_sig      text[];   -- words long enough to carry meaning
  v_prefix_q text;     -- 'orgoglio:* & pregiu:*'
  v_or_q     text;     -- 'visconte | dimezato'
  v_cand     uuid[] := '{}';
  v_extra    uuid[];
  v_answered boolean;
begin
  if v_term = '' then
    execute format($q$
      select array_agg(s.id) from (
        select b.id from public.books b
        where true %s
        order by (b.reads_count + b.saves_count + b.likes_count) desc
        limit 200
      ) s
    $q$, v_lang_sql)
    into v_cand;
  else
    v_words := array(
      select w from unnest(regexp_split_to_array(v_term, '[^a-z0-9]+')) w where w <> ''
    );
    v_sig := array(select w from unnest(v_words) w where length(w) >= 3);

    -- Every word as a prefix, ANDed: this is what makes "orgoglio pregiu" and
    -- "dostoev" work while the reader is still typing.
    v_prefix_q := array_to_string(array(select w || ':*' from unnest(v_words) w), ' & ');

    -- ---- pass one: precise and cheap -------------------------------------
    execute format($q$
      select array_agg(s.id) from (
        (select b.id from public.books b
          where b.search_tsv @@ websearch_to_tsquery('simple', %L) %s
          limit 400)
        union
        (select b.id from public.books b
          where b.search_tsv @@ to_tsquery('simple', %L) %s
          limit 300)
        union
        (select b.id from public.books b
          where public.immutable_unaccent(b.title) %% %L %s
          limit 300)
      ) s
    $q$, v_term, v_lang_sql, v_prefix_q, v_lang_sql, v_term, v_lang_sql)
    into v_cand;

    v_cand := coalesce(v_cand, '{}');

    -- Did any candidate actually answer the question? Volume is not the test:
    -- "kira shell" used to come back with eight rows — Shell Game, Hell's
    -- Kitchen, Kira-kira — and none of them was the author.
    if array_length(v_sig, 1) is null then
      v_answered := array_length(v_cand, 1) is not null;
    else
      select exists (
        select 1
        from public.books b
        where b.id = any(v_cand)
          and not exists (
            select 1 from unnest(v_sig) w
            where position(w in lower(public.immutable_unaccent(
                    b.title || ' ' || coalesce(array_to_string(b.authors, ' '), '')))) = 0
          )
      ) into v_answered;
    end if;

    -- ---- pass two: relaxed, only for queries pass one failed --------------
    if not v_answered then
      v_or_q := array_to_string(array(select w from unnest(v_words) w where length(w) >= 4), ' | ');

      execute format($q$
        select array_agg(s.id) from (
          (select b.id from public.books b
            where %L <%% public.immutable_unaccent(b.title) %s
            limit 300)
          union
          (select b.id from public.books b
            where %L <%% public.authors_text(b.authors) %s
            limit 300)
          union
          (select b.id from public.books b
            where %L <> '' and b.search_tsv @@ to_tsquery('simple', %L) %s
            limit 200)
        ) s
      $q$, v_term, v_lang_sql, v_term, v_lang_sql,
           v_or_q, coalesce(nullif(v_or_q, ''), 'zzzzzzzz'), v_lang_sql)
      into v_extra;

      v_cand := v_cand || coalesce(v_extra, '{}');
    end if;
  end if;

  if array_length(v_cand, 1) is null then return; end if;

  return query
  with hits as (
    select
      b.id, b.title, b.subtitle, b.authors, b.cover_url, b.published_year,
      b.categories, b.rating_sum, b.rating_count,
      b.reads_count, b.saves_count, b.likes_count, b.reviews_count,
      b.language, b.work_key,
      case
        when v_term = '' then 0
        else
          -- ts_rank has to be gated on an actual match. Left ungated it scores
          -- partial lexeme overlap, and since "il" and "grande" appear in
          -- thousands of titles, every one of them came back at 0.99 and buried
          -- the real answer. Matching every word is worth a flat point on top.
          case
            when b.search_tsv @@ websearch_to_tsquery('simple', v_term)
            then 1.0 + ts_rank(b.search_tsv, websearch_to_tsquery('simple', v_term))
            else 0
          end
          + case
              when v_prefix_q <> '' and b.search_tsv @@ to_tsquery('simple', v_prefix_q)
              then 0.5 else 0
            end
          + similarity(public.immutable_unaccent(b.title), v_term)
          + 0.60 * word_similarity(v_term, public.immutable_unaccent(b.title))
          + 0.50 * word_similarity(v_term, public.authors_text(b.authors))
          -- Solo in modalità morbida: col filtro netto sono tutti uguali, e con
          -- "Tutte" nessuna lingua deve essere privilegiata.
          + case when v_pref is not null and b.language = v_pref then 0.45 else 0 end
          + case when b.cover_url is not null then 0.05 else 0 end
      end as rank
    from public.books b
    where b.id = any(v_cand)
  ),
  ranked as (
    select h.*,
      row_number() over (
        -- Rows with no work_key fall back to their own id so they never group.
        partition by coalesce(nullif(h.work_key, ''), h.id::text)
        order by
          (v_pref is not null and h.language = v_pref) desc,
          (h.cover_url is not null) desc,
          h.rank desc,
          (h.reads_count + h.saves_count + h.likes_count + h.reviews_count) desc
      ) as edition_rank
    from hits h
  )
  select
    r.id, r.title, r.subtitle, r.authors, r.cover_url, r.published_year, r.categories,
    case when r.rating_count > 0
         then round(r.rating_sum::numeric / r.rating_count, 2) else null end as avg_rating,
    r.reads_count, r.saves_count, r.likes_count, r.reviews_count
  from ranked r
  where r.edition_rank = 1
  order by r.rank desc, (r.reads_count + r.saves_count + r.likes_count) desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;
grant execute on function public.search_books(text, int, int, text) to authenticated, anon;

-- --------------------------------------------------------------------
-- Generi: nomi italiani, sinonimi, ricerca
-- --------------------------------------------------------------------

-- I nomi di primo livello erano in inglese in un'app italiana.
update public.genres set name = v.name from (values
  ('scifi', 'Fantascienza'), ('mystery', 'Giallo'), ('literary', 'Narrativa'),
  ('historical', 'Storico'), ('nonfiction', 'Saggistica'), ('psychology', 'Psicologia'),
  ('self-help', 'Crescita personale'), ('biography', 'Biografie'), ('poetry', 'Poesia'),
  ('business', 'Economia')
) as v(slug, name) where public.genres.slug = v.slug;

-- Sinonimi: come un lettore chiama davvero un genere, nelle due lingue. Senza
-- questi "giallo" non trova `mystery` e "saggistica" non trova `nonfiction`.
alter table public.genres add column if not exists synonyms text[] not null default '{}';

update public.genres set synonyms = v.syn from (values
  ('fantasy',      array['fantasy','fantastico','epic fantasy','high fantasy']),
  ('scifi',        array['fantascienza','sci-fi','science fiction','sf','distopia','distopico']),
  ('thriller',     array['thriller','suspense','tensione']),
  ('romance',      array['romance','rosa','romantico','amore','love story']),
  ('mystery',      array['giallo','mystery','poliziesco','detective','indagine','crime']),
  ('horror',       array['horror','paura','terrore','spavento']),
  ('literary',     array['narrativa','letteratura','romanzo','literary fiction','classici']),
  ('historical',   array['storico','storia','historical','romanzo storico']),
  ('nonfiction',   array['saggistica','saggio','non fiction','nonfiction','divulgazione']),
  ('business',     array['economia','business','impresa','management','lavoro']),
  ('psychology',   array['psicologia','psychology','mente','psiche']),
  ('self-help',    array['crescita personale','self help','self-help','manuale','benessere']),
  ('biography',    array['biografie','biografia','memoir','autobiografia','biography']),
  ('young-adult',  array['young adult','ya','adolescenti','ragazzi']),
  ('poetry',       array['poesia','poesie','poetry','versi']),
  ('dark-romance', array['dark romance','dark','romance oscuro','morbido']),
  ('new-adult',    array['new adult','na']),
  ('romantasy',    array['romantasy','romance fantasy']),
  ('graphic-novel',array['graphic novel','fumetto','fumetti','comic','comics','graphic']),
  ('true-crime',   array['true crime','cronaca nera','crimine reale'])
) as v(slug, syn) where public.genres.slug = v.slug;

/**
 * Ricerca generi. Cerca sul nome, sullo slug e sui sinonimi, con la stessa
 * tolleranza ai refusi del resto della ricerca.
 *
 * Restituisce solo generi che hanno almeno un libro: proporre un genere vuoto
 * significa mandare il lettore in una stanza vuota, e 36 dei 51 generi in
 * tabella non hanno un solo libro.
 */
create or replace function public.search_genres(
  p_query text,
  p_limit int default 20
)
returns table (slug text, name text, book_count int)
language sql
stable
set search_path = public, extensions
set pg_trgm.word_similarity_threshold = '0.5'
as $$
  with term as (
    select lower(public.immutable_unaccent(trim(coalesce(p_query, '')))) as t
  ),
  scored as (
    select
      g.slug,
      g.name,
      (select count(*)::int from public.books b where g.slug = any(b.categories)) as n,
      greatest(
        -- corrispondenza esatta o per prefisso sul nome / slug
        case when lower(public.immutable_unaccent(g.name)) like term.t || '%' then 1.0 else 0 end,
        case when g.slug like term.t || '%' then 1.0 else 0 end,
        -- sinonimi
        coalesce((
          select max(case
                       when lower(public.immutable_unaccent(s)) like term.t || '%' then 0.95
                       else word_similarity(term.t, lower(public.immutable_unaccent(s)))
                     end)
          from unnest(g.synonyms) s
        ), 0),
        -- refusi sul nome
        word_similarity(term.t, lower(public.immutable_unaccent(g.name)))
      ) as score
    from public.genres g, term
    where term.t <> ''
  )
  select s.slug, s.name, s.n
  from scored s
  where s.score >= 0.5 and s.n > 0
  order by s.score desc, s.n desc
  limit greatest(p_limit, 0);
$$;
grant execute on function public.search_genres(text, int) to authenticated, anon;

-- internal_dispatch_push è una funzione trigger, quindi Postgres rifiuterebbe
-- comunque una chiamata diretta; ma era l'unica `internal_*` ancora eseguibile
-- da anon, e un invariante che vale "quasi sempre" non è un invariante.
revoke execute on function public.internal_dispatch_push() from public, anon, authenticated;

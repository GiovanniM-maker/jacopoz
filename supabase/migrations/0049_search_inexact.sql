-- =====================================================================
-- 0049 — find the book when the reader does not type it exactly
--
-- Measured against 29 realistic misspellings and partial titles, the old
-- search resolved 17. The failures were all the same shape: full-text match
-- requires *every* word, and the trigram branch compares the query against the
-- *whole* title, so one wrong letter inside a longer title scores far below any
-- workable threshold.
--
--   word_similarity('gatsbi',   'il grande gatsby')     = 0.71   vs similarity 0.28
--   word_similarity('dimezato', 'il visconte dimezzato')= 0.73
--   word_similarity('marques',  'gabriel garcia marquez')= 0.75
--
-- word_similarity scores the query against the best-matching run of words in
-- the target, which is exactly the question being asked, and its `<%` operator
-- rides the same GIN trigram indexes.
--
-- The catch is cost. At a threshold of 0.4 — low enough to reach 'machbet' ->
-- 'Macbeth', which scores exactly 0.4 — those branches measured 20-228 ms on
-- title and 24-224 ms on authors, per branch. Paying that on every keystroke
-- would undo migration 0046.
--
-- So this is two passes. The first is the cheap, precise one (full-text AND,
-- prefix full-text for as-you-type, whole-title trigram) and covers everything
-- that already worked. Then it asks a concrete question of the result — does
-- any candidate actually contain every significant word of the query? — and
-- only if the answer is no does it run the relaxed pass. Queries that were
-- already working keep 0046's latency; the ones that returned nothing get the
-- expensive treatment they need.
--
-- Both thresholds are set at function level to the *widest* value used, because
-- the GUC is what gates the index scan and a single call cannot have two
-- values. Pass one simply doesn't use the word_similarity operators.
-- =====================================================================

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
  v_pref  text := coalesce(
                    nullif(p_lang, ''),
                    (select pr.reading_language from public.profiles pr where pr.id = auth.uid()),
                    'it');
  v_words    text[];
  v_sig      text[];   -- words long enough to carry meaning
  v_prefix_q text;     -- 'orgoglio:* & pregiu:*'
  v_or_q     text;     -- 'visconte | dimezato'
  v_cand     uuid[] := '{}';
  v_extra    uuid[];
  v_answered boolean;
begin
  if v_term = '' then
    -- No query: the popular shelf, and nothing else to do.
    select array_agg(s.id) into v_cand
    from (
      select b.id from public.books b
      order by (b.reads_count + b.saves_count + b.likes_count) desc
      limit 200
    ) s;
  else
    v_words := array(
      select w from unnest(regexp_split_to_array(v_term, '[^a-z0-9]+')) w where w <> ''
    );
    v_sig := array(select w from unnest(v_words) w where length(w) >= 3);

    -- Every word as a prefix, ANDed: this is what makes "orgoglio pregiu" and
    -- "dostoev" work while the reader is still typing. Words are already
    -- reduced to [a-z0-9] by immutable_unaccent + the split, so there is
    -- nothing to escape.
    v_prefix_q := array_to_string(array(select w || ':*' from unnest(v_words) w), ' & ');

    -- ---- pass one: precise and cheap -------------------------------------
    execute format($q$
      select array_agg(s.id) from (
        (select b.id from public.books b
          where b.search_tsv @@ websearch_to_tsquery('simple', %L)
          limit 400)
        union
        (select b.id from public.books b
          where b.search_tsv @@ to_tsquery('simple', %L)
          limit 300)
        union
        (select b.id from public.books b
          where public.immutable_unaccent(b.title) %% %L
          limit 300)
      ) s
    $q$, v_term, v_prefix_q, v_term)
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
      -- Any single meaningful word is enough here; four characters keeps
      -- articles and prepositions ("il", "e", "con", "dei") from matching the
      -- whole catalogue.
      v_or_q := array_to_string(array(select w from unnest(v_words) w where length(w) >= 4), ' | ');

      execute format($q$
        select array_agg(s.id) from (
          (select b.id from public.books b
            where %L <%% public.immutable_unaccent(b.title)
            limit 300)
          union
          (select b.id from public.books b
            where %L <%% public.authors_text(b.authors)
            limit 300)
          union
          (select b.id from public.books b
            where %L <> '' and b.search_tsv @@ to_tsquery('simple', %L)
            limit 200)
        ) s
      $q$, v_term, v_term, v_or_q, coalesce(nullif(v_or_q, ''), 'zzzzzzzz'))
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
          -- the real answer. Matching every word is worth a flat point on top,
          -- so a precise hit always outranks a near miss.
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
          + case when b.language = v_pref then 0.45 else 0 end
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
          (h.language = v_pref) desc,
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

-- search_authors gets the same treatment: an ILIKE substring cannot match a
-- misspelt surname at all, so "dostoiewski" and "marques" found nothing.
-- Substring first (exact, cheap), then word_similarity only if that was empty.
create or replace function public.search_authors(
  p_query text,
  p_limit int default 30
)
returns table (author text, book_count int)
-- No temp table and no plpgsql branch: `exact` is referenced twice so Postgres
-- materialises it, which turns the `not exists` in `fuzzy` into a one-time
-- filter — the expensive branch is skipped outright when the cheap one matched.
language sql
stable
set search_path = public, extensions
set pg_trgm.word_similarity_threshold = '0.4'
as $$
  with term as (
    select
      public.immutable_unaccent(trim(coalesce(p_query, ''))) as t,
      -- Escaped for LIKE: the backslash goes first, or "\" alone leaves a
      -- dangling escape and errors.
      '%' || replace(replace(replace(
        public.immutable_unaccent(trim(coalesce(p_query, ''))),
        '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  ),
  exact as (
    select a.author, count(*)::int as c
    from public.books b, unnest(b.authors) as a(author), term
    where term.t <> ''
      and public.authors_text(b.authors) ilike term.pat escape '\'
      and public.immutable_unaccent(a.author) ilike term.pat escape '\'
    group by a.author
  ),
  fuzzy as (
    select a.author, count(*)::int as c
    from public.books b, unnest(b.authors) as a(author), term
    where term.t <> ''
      and not exists (select 1 from exact)
      and term.t <% public.authors_text(b.authors)
      and word_similarity(term.t, public.immutable_unaccent(a.author)) >= 0.4
    group by a.author
  )
  select author, c from exact
  union all
  select author, c from fuzzy
  order by c desc, author
  limit greatest(p_limit, 0);
$$;
grant execute on function public.search_authors(text, int) to authenticated, anon;

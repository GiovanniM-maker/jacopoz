-- =====================================================================
-- 0056 — la vetrina deve preferire i libri che hanno una copertina
--
-- Controllo C-4: fra i primi cento risultati a ricerca vuota ne comparivano
-- quattro senza copertina. Non è un caso sfortunato, è il criterio: il ramo
-- della query vuota ordina per `reads + saves + likes`, e siccome quasi tutto
-- il catalogo è a zero il pareggio lascia salire chiunque — compreso chi non ha
-- niente da mostrare.
--
-- Una scheda spoglia in vetrina è un risultato che nessuno tocca, quindi la
-- copertina viene prima della popolarità quando la popolarità non distingue.
--
-- Il resto della funzione è identico a 0051.
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
  -- noticed, but position() below does not.
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
  v_lang_sql text := case when v_hard is null then ''
                          else format(' and b.language = %L', v_hard) end;

  v_words    text[];
  v_sig      text[];
  v_prefix_q text;
  v_or_q     text;
  v_cand     uuid[] := '{}';
  v_extra    uuid[];
  v_answered boolean;
begin
  if v_term = '' then
    execute format($q$
      select array_agg(s.id) from (
        select b.id from public.books b
        where true %s
        order by (b.cover_url is not null) desc,
                 (b.reads_count + b.saves_count + b.likes_count) desc
        limit 200
      ) s
    $q$, v_lang_sql)
    into v_cand;
  else
    v_words := array(
      select w from unnest(regexp_split_to_array(v_term, '[^a-z0-9]+')) w where w <> ''
    );
    v_sig := array(select w from unnest(v_words) w where length(w) >= 3);
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
        when v_term = '' then case when b.cover_url is not null then 0.05 else 0 end
        else
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
          + case when v_pref is not null and b.language = v_pref then 0.45 else 0 end
          + case when b.cover_url is not null then 0.05 else 0 end
      end as rank
    from public.books b
    where b.id = any(v_cand)
  ),
  ranked as (
    select h.*,
      row_number() over (
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
  -- La copertina prima di tutto: fra due libri altrimenti pari, quello che si
  -- vede vince.
  order by (r.cover_url is not null) desc,
           r.rank desc,
           (r.reads_count + r.saves_count + r.likes_count) desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;
grant execute on function public.search_books(text, int, int, text) to authenticated, anon;

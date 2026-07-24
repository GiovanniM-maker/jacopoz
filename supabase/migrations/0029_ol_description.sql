-- =====================================================================
-- 0029 — Open Library work descriptions (broader free synopsis coverage)
--
-- Wikipedia only has articles for famous titles, so it misses most of the
-- obscure catalog. Open Library has work-level descriptions for many more
-- books (incl. obscure ones), free and unlimited. We already do an OL
-- search per book for ratings — extend it to grab the work key, then fetch
-- the work JSON and use its description. Wikipedia stays as the other
-- source; whichever fills books.description first (while empty) wins.
-- =====================================================================

-- Enqueue: add the work `key` to the OL ratings search fields.
create or replace function public.internal_enrich_enqueue()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  b       record;
  v_req   bigint;
  v_lang  text;
  v_query text;
  c_ua    constant jsonb := jsonb_build_object('User-Agent', 'TomoBeta/1.0 (book community app)');
begin
  delete from public.enrich_jobs where created_at < now() - interval '1 hour';

  for b in
    select bk.* from public.books bk
    where bk.enrich_requested_at is not null
      and (bk.enriched_at is null or bk.enriched_at < now() - interval '90 days')
    order by bk.enrich_requested_at
    limit 8
  loop
    update public.books set enriched_at = now() where id = b.id;

    v_query := case
      when b.isbn_13 is not null then 'isbn:' || b.isbn_13
      else b.title || ' ' || coalesce(b.authors[1], '')
    end;
    select net.http_get(
      url := 'https://openlibrary.org/search.json?limit=1&fields=ratings_average,ratings_count,key&q='
             || public.urlencode(v_query),
      headers := c_ua,
      timeout_milliseconds := 20000
    ) into v_req;
    insert into public.enrich_jobs (book_id, kind, request_id)
    values (b.id, 'ol_ratings', v_req);

    v_lang := case when b.language = 'it' then 'it' else 'en' end;
    select net.http_get(
      url := 'https://' || v_lang || '.wikipedia.org/w/api.php?action=query&list=search'
             || '&format=json&srlimit=1&srsearch='
             || public.urlencode(b.title || ' ' || coalesce(b.authors[1], '')
                                 || case when v_lang = 'it' then ' romanzo' else ' novel' end),
      headers := c_ua,
      timeout_milliseconds := 20000
    ) into v_req;
    insert into public.enrich_jobs (book_id, kind, lang, request_id)
    values (b.id, 'wiki_search_' || v_lang, v_lang, v_req);
  end loop;
end;
$$;

-- Ingest: chain ol_ratings → ol_work (fetch work JSON) → description.
create or replace function public.internal_enrich_ingest()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  j       record;
  v_json  jsonb;
  v_title text;
  v_req   bigint;
  v_other text;
  v_key   text;
  v_desc  text;
  c_ua    constant jsonb := jsonb_build_object('User-Agent', 'TomoBeta/1.0 (book community app)');
begin
  for j in
    select ej.*, resp.status_code, resp.content
    from public.enrich_jobs ej
    join net._http_response resp on resp.id = ej.request_id
  loop
    if j.status_code = 200 then
      v_json := j.content::jsonb;

      if j.kind = 'ol_ratings' then
        update public.books
        set external_rating        = nullif((v_json -> 'docs' -> 0 ->> 'ratings_average'), '')::numeric,
            external_ratings_count = nullif((v_json -> 'docs' -> 0 ->> 'ratings_count'), '')::int
        where id = j.book_id;

        -- Chain to the work JSON for a description (obscure books included).
        v_key := v_json -> 'docs' -> 0 ->> 'key';
        if v_key is not null then
          select net.http_get(
            url := 'https://openlibrary.org' || v_key || '.json',
            headers := c_ua,
            timeout_milliseconds := 20000
          ) into v_req;
          insert into public.enrich_jobs (book_id, kind, request_id)
          values (j.book_id, 'ol_work', v_req);
        end if;

      elsif j.kind = 'ol_work' then
        -- description is either a plain string or { "type": ..., "value": ... }
        v_desc := coalesce(v_json ->> 'description', v_json -> 'description' ->> 'value');
        -- strip Open Library's trailing source footnotes, e.g. "([source][1])"
        v_desc := regexp_replace(coalesce(v_desc, ''), '\s*\(\[.*$', '');
        if length(trim(v_desc)) > 20 then
          update public.books
          set description = left(trim(v_desc), 1500)
          where id = j.book_id and coalesce(description, '') = '';
        end if;

      elsif j.kind in ('wiki_search_it', 'wiki_search_en') then
        v_title := v_json -> 'query' -> 'search' -> 0 ->> 'title';
        if v_title is not null then
          select net.http_get(
            url := 'https://' || j.lang || '.wikipedia.org/api/rest_v1/page/summary/'
                   || public.urlencode(replace(v_title, ' ', '_')),
            headers := c_ua,
            timeout_milliseconds := 20000
          ) into v_req;
          insert into public.enrich_jobs (book_id, kind, lang, payload, request_id)
          values (j.book_id, 'wiki_summary', j.lang, v_title, v_req);
        elsif j.kind = 'wiki_search_it' then
          select b2.title || ' ' || coalesce(b2.authors[1], '') into v_other
          from public.books b2 where b2.id = j.book_id;
          select net.http_get(
            url := 'https://en.wikipedia.org/w/api.php?action=query&list=search'
                   || '&format=json&srlimit=1&srsearch=' || public.urlencode(v_other || ' novel'),
            headers := c_ua,
            timeout_milliseconds := 20000
          ) into v_req;
          insert into public.enrich_jobs (book_id, kind, lang, request_id)
          values (j.book_id, 'wiki_search_en', 'en', v_req);
        end if;

      elsif j.kind = 'wiki_summary' then
        if coalesce(v_json ->> 'extract', '') <> ''
           and (v_json ->> 'type') = 'standard'
           and coalesce(v_json ->> 'description', '') !~* '(film|movie|miniserie|tv series|serie tv)' then
          insert into public.external_reviews
            (book_id, source, source_label, excerpt, url, license)
          values (
            j.book_id, 'wikipedia',
            'Wikipedia (' || j.lang || ')',
            left(v_json ->> 'extract', 700),
            v_json -> 'content_urls' -> 'desktop' ->> 'page',
            'CC BY-SA 4.0'
          )
          on conflict (book_id, source) do update
            set excerpt = excluded.excerpt, url = excluded.url, fetched_at = now();

          update public.books
          set description = left(v_json ->> 'extract', 1500)
          where id = j.book_id and coalesce(description, '') = '';
        end if;
      end if;
    end if;

    delete from public.enrich_jobs where id = j.id;
  end loop;
end;
$$;

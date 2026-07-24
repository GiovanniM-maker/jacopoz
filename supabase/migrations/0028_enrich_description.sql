-- =====================================================================
-- 0028 — fill book descriptions from Wikipedia
--
-- Our primary sources (Gutendex, Open Library search) don't return a plot
-- summary, so books.description was empty catalog-wide. The enrichment
-- pipeline already fetches a Wikipedia summary (the "extract") per book —
-- so here we also write that extract into books.description when the book
-- has none. The extract is exactly a "what this book is about" synopsis.
-- Only the wiki_summary branch changes; everything else is verbatim.
-- =====================================================================

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

          -- NEW: use the same extract as the book's synopsis when it has none.
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

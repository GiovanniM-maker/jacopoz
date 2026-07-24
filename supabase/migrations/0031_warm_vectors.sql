-- =====================================================================
-- 0031 — keep the vector index warm
--
-- On a small-RAM instance the HNSW index gets evicted from cache, so the
-- first semantic query after idle pages it back from disk (~250ms-1s) while
-- a warm query is ~3ms. A once-a-minute touch keeps it resident, so
-- recommendations / "simili" stay fast. (The proper fix is more RAM — a
-- compute upgrade — after which this is belt-and-braces.)
-- =====================================================================

drop function if exists public._warmtest();

create or replace function public.internal_keep_vectors_warm()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v extensions.vector(512);
begin
  set local hnsw.ef_search = 24;
  select embedding into v from public.books where embedding is not null limit 1;
  if v is not null then
    perform 1 from public.books
    where embedding is not null
    order by embedding <=> v
    limit 5;
  end if;
end;
$$;

revoke execute on function public.internal_keep_vectors_warm() from public, anon, authenticated;

select cron.schedule('warm-vectors', '* * * * *', $$select public.internal_keep_vectors_warm()$$);

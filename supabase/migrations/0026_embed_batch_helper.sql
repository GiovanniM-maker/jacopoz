-- =====================================================================
-- 0026 — parameterized embedding enqueue (ops helper)
--
-- Same as internal_embed_enqueue() but with a caller-chosen batch size, so a
-- one-off bulk catalog import (e.g. the Project Gutenberg seed) can be
-- embedded quickly by driving larger batches, instead of waiting for the
-- 64-per-5-minutes cron. The nightly cron (internal_embed_enqueue) is
-- unchanged and still the steady-state path.
-- =====================================================================

create or replace function public.internal_embed_enqueue_n(p_n int)
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key   text;
  v_ids   uuid[];
  v_texts jsonb;
  v_req   bigint;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'openrouter_api_key';
  if v_key is null then return 0; end if;

  select array_agg(x.id), jsonb_agg(public.book_embedding_text(x.*))
    into v_ids, v_texts
  from (
    select b.*
    from public.books b
    where b.embedding is null
      and not exists (select 1 from public.embed_batches eb where b.id = any(eb.book_ids))
    order by b.created_at desc
    limit greatest(p_n, 1)
  ) x;
  if v_ids is null then return 0; end if;

  select net.http_post(
    url     := 'https://openrouter.ai/api/v1/embeddings',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body    := jsonb_build_object('model', 'openai/text-embedding-3-small', 'input', v_texts, 'dimensions', 512),
    timeout_milliseconds := 55000
  ) into v_req;

  insert into public.embed_batches (request_id, book_ids) values (v_req, v_ids);
  return array_length(v_ids, 1);
end;
$$;

revoke execute on function public.internal_embed_enqueue_n(int) from public, anon, authenticated;

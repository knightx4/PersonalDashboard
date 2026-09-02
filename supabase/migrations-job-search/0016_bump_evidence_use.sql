-- Counting the use of an evidence item.
--
-- `evidence_items.used_count` has existed since the MVP with the comment
-- "incremented on use, so drafts rotate rather than repeat", and nothing has
-- ever incremented it. Drafting is what finally uses the bank, so this is what
-- it counts with.
--
-- Incrementing in place needs SQL: PostgREST can set a column to a value but
-- not to "itself plus one", and reading each row to write it back would be one
-- round trip per cited item for no benefit. Same shape and same reasoning as
-- `bump_relink_attempts` in 0009.
--
-- `security invoker`, so RLS still decides which rows a caller can touch. This
-- function is not a way around the policy on evidence_items; it is a way to
-- write `+ 1`.

set search_path = job_search, extensions;

create or replace function job_search.bump_evidence_use(item_ids uuid[])
returns void
language sql
security invoker
set search_path = job_search, pg_temp
as $$
  update job_search.evidence_items
     set used_count = used_count + 1,
         updated_at = now()
   where id = any(item_ids);
$$;

revoke all on function job_search.bump_evidence_use(uuid[]) from public;
grant execute on function job_search.bump_evidence_use(uuid[]) to authenticated, service_role;

-- Merging roles that both have a thread failed with "permission denied for
-- table dash_failures".
--
-- move_role_thread (0075) points every row that refers to the merged role's
-- conversation at the kept one, finding the tables from the foreign keys. Two
-- of those tables, core.dash_failures (0297) and core.dash_lookup_caps
-- (0317), are append-only bookkeeping: the person may read and insert their
-- rows but not update them. Postgres checks the update privilege before it
-- looks for rows, so the update failed even when neither table held a row for
-- that conversation, and the whole merge rolled back.
--
-- The loop now skips a column the caller may not update. Both tables say
-- `on delete set null`, so when the empty conversation is taken out their
-- rows, if any, keep everything but the link. A thread's failures are kept
-- with no conversation anyway (0297 says so), so nothing a merge used to
-- carry is lost. A table that is skipped and refuses the delete still stops
-- the merge, with its own foreign key error.
--
-- Schema only: no row is written or changed here.

set search_path = job_search, extensions;

create or replace function job_search.move_role_thread(
  p_user_id uuid,
  p_from_role uuid,
  p_to_role uuid
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  from_ref text := 'job_search.roles:' || p_from_role;
  to_ref text := 'job_search.roles:' || p_to_role;
  from_conversation uuid;
  to_conversation uuid;
  fk record;
  n integer;
  moved integer := 0;
begin
  select id into from_conversation from core.conversations
  where user_id = p_user_id and subject_kind = 'row' and subject_ref = from_ref
  for update;
  if from_conversation is null then
    return 0;
  end if;

  select id into to_conversation from core.conversations
  where user_id = p_user_id and subject_kind = 'row' and subject_ref = to_ref
  for update;
  if to_conversation is null then
    update core.conversations set subject_ref = to_ref where id = from_conversation;
    select pg_catalog.count(*)::integer into n from core.conversation_turns where conversation_id = from_conversation;
    return n;
  end if;

  for fk in
    select c.conrelid::regclass as tbl, a.attname::text as col
    from pg_catalog.pg_constraint c
    cross join lateral pg_catalog.unnest(c.conkey, c.confkey) as k(child, parent)
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.child
    join pg_catalog.pg_attribute p on p.attrelid = c.confrelid and p.attnum = k.parent
    where c.confrelid = 'core.conversations'::regclass and c.contype = 'f' and p.attname = 'id'
      -- Append-only bookkeeping is left to its foreign key's delete rule.
      and pg_catalog.has_column_privilege(c.conrelid, a.attname, 'UPDATE')
  loop
    execute pg_catalog.format('update %s set %I = $1 where %I = $2', fk.tbl, fk.col, fk.col)
      using to_conversation, from_conversation;
    get diagnostics n = row_count;
    moved := moved + n;
  end loop;

  delete from core.conversations where id = from_conversation;
  return moved;
end;
$$;

comment on function job_search.move_role_thread(uuid, uuid, uuid) is
  'Moves the thread under role p_from_role onto role p_to_role, joining it to any thread already there; tables the caller may not update (append-only bookkeeping) are left to their foreign key''s delete rule. Used by merge_roles. Security invoker.';

revoke all on function job_search.move_role_thread(uuid, uuid, uuid) from public, anon;
grant execute on function job_search.move_role_thread(uuid, uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

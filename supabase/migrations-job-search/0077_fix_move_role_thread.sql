-- Fix move_role_thread, which failed every merge of a role with a thread.
--
-- 0075 read each foreign key's columns with pg_catalog.unnest(conkey,
-- confkey). Postgres takes the two-array form of unnest only when the name
-- is written bare, so the schema-qualified call raised "function
-- pg_catalog.unnest(smallint[], smallint[]) does not exist" and the Merge
-- roles button on a company's Roles tab showed it.
--
-- The function now pairs the columns with rows from (unnest(conkey),
-- unnest(confkey)), which means the same and takes qualified names. The keys
-- onto core.conversations are two columns (the conversation and its user),
-- so reading conkey[1] alone, as 0057 and 0058 do, would not do here.

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
    cross join lateral rows from (pg_catalog.unnest(c.conkey), pg_catalog.unnest(c.confkey)) as k(child, parent)
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.child
    join pg_catalog.pg_attribute p on p.attrelid = c.confrelid and p.attnum = k.parent
    where c.confrelid = 'core.conversations'::regclass and c.contype = 'f' and p.attname = 'id'
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
  'Moves the thread under role p_from_role onto role p_to_role, joining it to any thread already there. Used by merge_roles. Security invoker.';

revoke all on function job_search.move_role_thread(uuid, uuid, uuid) from public, anon;
grant execute on function job_search.move_role_thread(uuid, uuid, uuid) to authenticated, service_role;

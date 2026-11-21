-- move_role_thread could never join two threads: it paired each foreign
-- key's columns with `pg_catalog.unnest(c.conkey, c.confkey)`. The
-- two-argument unnest is a shorthand Postgres only reads unqualified; written
-- as pg_catalog.unnest it looks for a function that does not exist, so a
-- merge of two roles that both had a thread failed with "function
-- pg_catalog.unnest(smallint[], smallint[]) does not exist". 0075 had it and
-- 0082 copied it. The pairs now come from `rows from` with two one-argument
-- unnests, which is what the shorthand stands for.
--
-- Otherwise 0082's function. Schema only: no row is written or changed here.

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

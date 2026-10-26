-- Merge roles whose threads have comments, carrying the comments over.
--
-- 0058 refused to merge a role with comments in its thread, because the
-- thread sits under the role's ref (`job_search.roles:<id>`) in
-- core.conversations and nothing moved it. A posting filed twice often has a
-- comment on each copy, and then neither could be kept, so the two Baselayer
-- roles could not be merged at all.
--
-- move_role_thread(user, from, to)
--   Moves the merged role's thread onto the role kept. When the role kept
--   has no thread, the conversation is renamed to its ref. When it has one,
--   every row pointing at the merged role's conversation (its turns, and the
--   Dash actions and hand-offs written in it) is pointed at the kept one, read
--   from the foreign keys as move_children does, and the empty conversation
--   is taken out. The turns keep their times, so the two threads read as one
--   in the order they were written. Security invoker.
--
-- merge_roles is 0058's, with the refusal replaced by that call. Dash's own
-- merge still refuses a role with comments: its Undo puts rows back from what
-- it read, and it does not read threads.

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

create or replace function job_search.merge_roles(
  p_keep_role uuid,
  p_merge_roles uuid[],
  p_keep_application uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  kept job_search.roles%rowtype;
  target job_search.applications%rowtype;
  app job_search.applications%rowtype;
  merged uuid[];
  merged_role uuid;
  override job_search.applications.status_manual_override%type;
  moved integer := 0;
begin
  merged := array(select distinct m from pg_catalog.unnest(p_merge_roles) as m where m is not null);
  if pg_catalog.cardinality(merged) = 0 then
    raise exception 'Pick the roles to merge in.' using errcode = '22023';
  end if;
  if p_keep_role = any (merged) then
    raise exception 'Pick a different role to merge into.' using errcode = '22023';
  end if;

  select * into kept from job_search.roles where id = p_keep_role for update;
  if kept.id is null
    or (select count(*) from job_search.roles where id = any (merged)) <> pg_catalog.cardinality(merged) then
    raise exception 'One of those roles no longer exists.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from job_search.roles
    where id = any (merged) and (company_id <> kept.company_id or user_id <> kept.user_id)
  ) then
    raise exception 'Roles can only be merged within the same company.' using errcode = '22023';
  end if;

  if exists (select 1 from job_search.applications where role_id = any (merged || p_keep_role)) then
    select * into target from job_search.applications
    where id = p_keep_application and role_id = any (merged || p_keep_role)
    for update;
    if target.id is null then
      raise exception 'Name the application to keep, one of those roles''.' using errcode = '22023';
    end if;

    for app in
      select * from job_search.applications
      where role_id = any (merged || p_keep_role) and id <> target.id
    loop
      moved := moved + job_search.move_children('job_search.applications', app.id, target.id);
      -- A status set by hand is their decision; keep it when the kept one has none.
      if target.status_manual_override is null and override is null then
        override := app.status_manual_override;
      end if;
      delete from job_search.applications where id = app.id;
    end loop;

    update job_search.applications set
      role_id = p_keep_role,
      attempt = 1,
      status_manual_override = coalesce(status_manual_override, override)
    where id = target.id;
  end if;

  foreach merged_role in array merged loop
    moved := moved + job_search.move_role_thread(kept.user_id, merged_role, p_keep_role);
    moved := moved + job_search.move_children(
      'job_search.roles', merged_role, p_keep_role, array['job_search.applications'::regclass]
    );
    delete from job_search.roles where id = merged_role;
  end loop;

  return pg_catalog.jsonb_build_object(
    'kept', p_keep_role,
    'merged', pg_catalog.cardinality(merged),
    'moved', moved
  );
end;
$$;

comment on function job_search.merge_roles(uuid, uuid[], uuid) is
  'Folds p_merge_roles into p_keep_role: their applications become p_keep_application, every row pointing at a merged application or role is moved by its foreign key (move_children), each merged role''s thread joins the kept role''s (move_role_thread), and the merged rows are deleted. Security invoker.';

notify pgrst, 'reload schema';

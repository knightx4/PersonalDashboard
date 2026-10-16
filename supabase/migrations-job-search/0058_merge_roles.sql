-- Fold duplicate roles into one in the database, reading what to move from the
-- foreign keys.
--
-- The Merge roles button on a company page moved the rows of eight tables by
-- a list written in its action. Fourteen tables point at an application, so
-- merging deleted the rest with the duplicate: on Heron Data that would have
-- been the link to the interview email and the interview's round. Dash's
-- merge_roles kept its own list, which had missed application_drafts. Both
-- lists were right when written and fell behind as tables were added.
--
-- move_children(parent, from, to, skip)
--   Points every row that references `from` through a single-column foreign
--   key to `parent` at `to` instead. A row that would duplicate one `to`
--   already has under a unique key (an answer to the same question, the same
--   calendar invite) is taken out instead, as Dash's merge does. Tables in
--   `skip` are left for the caller. Security invoker, so row-level security
--   limits it to the caller's rows.
--
-- merge_roles(keep_role, merge_roles, keep_application)
--   Folds the roles into the one kept, in one transaction. Their applications
--   become `keep_application`, which the caller picks (the page ranks status
--   in lib/jobs/pipeline.ts, so the choice stays there). A status set by hand
--   on a merged application is carried over when the kept one has none. A
--   role with comments in its thread is refused: the thread is keyed by the
--   role's ref, which nothing here can move.

set search_path = job_search, extensions;

create or replace function job_search.move_children(
  p_parent regclass,
  p_from uuid,
  p_to uuid,
  p_skip regclass[] default '{}'
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  fk record;
  target tid;
  moved integer := 0;
begin
  for fk in
    select c.conrelid::regclass as tbl, a.attname::text as col
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.confrelid = p_parent and c.contype = 'f'
      and pg_catalog.array_length(c.conkey, 1) = 1
      and not (c.conrelid::regclass = any (p_skip))
  loop
    for target in
      execute pg_catalog.format('select ctid from %s where %I = $1', fk.tbl, fk.col) using p_from
    loop
      begin
        execute pg_catalog.format('update %s set %I = $1 where ctid = $2', fk.tbl, fk.col)
          using p_to, target;
        moved := moved + 1;
      exception when unique_violation then
        -- `to` already has this row's twin under a unique key.
        execute pg_catalog.format('delete from %s where ctid = $1', fk.tbl) using target;
      end;
    end loop;
  end loop;
  return moved;
end;
$$;

comment on function job_search.move_children(regclass, uuid, uuid, regclass[]) is
  'Repoints every row referencing p_from through a single-column foreign key to p_parent at p_to; a row that would duplicate a unique key under p_to is deleted. Tables in p_skip are left alone. Security invoker.';

revoke all on function job_search.move_children(regclass, uuid, uuid, regclass[]) from public, anon;
grant execute on function job_search.move_children(regclass, uuid, uuid, regclass[]) to authenticated, service_role;

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
  if exists (
    select 1 from core.thread_turns
    where ref = any (array(select 'job_search.roles:' || m from pg_catalog.unnest(merged) as m))
  ) then
    raise exception 'One of those roles has comments in its thread, which a merge would leave behind. Keep that role instead.'
      using errcode = '22023';
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
  'Folds p_merge_roles into p_keep_role: their applications become p_keep_application, every row pointing at a merged application or role is moved by its foreign key (move_children), and the merged rows are deleted. Security invoker.';

revoke all on function job_search.merge_roles(uuid, uuid[], uuid) from public, anon;
grant execute on function job_search.merge_roles(uuid, uuid[], uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

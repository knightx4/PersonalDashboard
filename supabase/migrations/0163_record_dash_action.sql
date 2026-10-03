-- One call for a routine to record a change it made (plan #1460).
--
-- docs/CORE-AND-DASH-SPEC.md, Part 5. Claude Code routines (the goals, dash-backup,
-- notes and plan skills) write the person's rows through the Supabase
-- connector, not through the app, so lib/core/dash-actions.ts never sees
-- those writes. They record each one themselves, by calling this function in
-- the same execute_sql call as the write, and the skills say so
-- (tests/skills-record-dash-actions.test.ts checks that they do).
--
-- core.record_dash_action writes the same row recordDashAction writes in the
-- app: status 'done' with done_at, the subject ref, the op, the whole row
-- before and after, and the summary the person reads on Home. It reads the
-- row after the write itself, from the ref. The row before an update or a
-- delete cannot be read once the write has happened, so the routine either
-- passes it, or calls core.dash_before with the ref just before the write,
-- which keeps the row until the end of the call:
--
--   select core.dash_before('goals.items:<id>');
--   update goals.items set status = 'done' where id = '<id>' and user_id = '<user>';
--   select core.record_dash_action('<user>', 'goals.items:<id>', 'update',
--     'close_step', 'Dash closed "Send the form", since the reply came on 2 October.');
--
-- An update or delete recorded with no before row is kept, saying what
-- happened, but cannot be undone, the same as in the app.
--
-- Both refuse rather than record something wrong: a ref outside the app's
-- schemas, a table that does not exist, a row that is not there after an
-- insert or update, or a row belonging to another account. A refusal is an
-- error, so the whole call rolls back, write included, and the routine sees
-- why.
--
-- Routines run as the connector's own role, never as the person, so the
-- account is passed in, and neither function is open to the app's roles:
-- only service_role (and the owner) may run them. They run as the caller
-- (security invoker), so they reach nothing the caller could not.

set search_path = core, public, extensions;

-- The row a ref names, as one jsonb object, or null when it is not there.
-- Refuses a ref that does not name a table in one of the app's schemas.
create or replace function core.dash_subject_row(p_subject_ref text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  parts text[];
  target regclass;
  id_type text;
  found jsonb;
begin
  parts := regexp_match(p_subject_ref, '^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*):(\S+)$');
  if parts is null then
    raise exception 'not a ref: % (write schema.table:id)', p_subject_ref
      using errcode = 'invalid_parameter_value';
  end if;
  if parts[1] not in ('public', 'core', 'job_search', 'obsidian', 'todo', 'learn', 'news', 'goals') then
    raise exception 'Dash does not record changes in the % schema', parts[1]
      using errcode = 'invalid_parameter_value';
  end if;
  target := to_regclass(format('%I.%I', parts[1], parts[2]));
  if target is null then
    raise exception 'no table %.%', parts[1], parts[2] using errcode = 'undefined_table';
  end if;
  select format_type(a.atttypid, a.atttypmod) into id_type
  from pg_catalog.pg_attribute a
  where a.attrelid = target and a.attname = 'id' and not a.attisdropped;
  if id_type is null then
    raise exception '%.% has no id column', parts[1], parts[2] using errcode = 'undefined_column';
  end if;
  execute format('select to_jsonb(t) from %s t where t.id = $1::%s', target, id_type)
    into found using parts[3];
  return found;
end;
$$;

-- Keep the row a ref names as it is now, for the record_dash_action call that
-- follows the write. Kept in a setting that lasts until the end of the
-- transaction, which for the connector is the execute_sql call. Returns the
-- row, or null when it is not there.
create or replace function core.dash_before(p_subject_ref text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  found jsonb := core.dash_subject_row(p_subject_ref);
  kept jsonb := coalesce(nullif(current_setting('core.dash_before', true), ''), '{}')::jsonb;
begin
  perform set_config(
    'core.dash_before',
    (kept || jsonb_build_object(p_subject_ref, found))::text,
    true
  );
  return found;
end;
$$;

-- Record a change a routine has just made, as done. Returns the record's id.
--
--   p_user_id      the account the row belongs to
--   p_subject_ref  the row written, as schema.table:id
--   p_op           insert, update or delete
--   p_kind         what was done, in snake_case: close_step, add_step, file_record
--   p_summary      the sentence the person reads on Home, naming Dash; cut at
--                  300 characters
--   p_before       the whole row before an update or delete; left out, the
--                  one dash_before kept for this ref is used
--   p_surface      'routine', or 'scheduled' for a run the app started
create or replace function core.record_dash_action(
  p_user_id uuid,
  p_subject_ref text,
  p_op text,
  p_kind text,
  p_summary text,
  p_before jsonb default null,
  p_surface text default 'routine'
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  before_row jsonb;
  after_row jsonb;
  flat text;
  new_id uuid;
begin
  if p_user_id is null then
    raise exception 'say whose change this is' using errcode = 'invalid_parameter_value';
  end if;
  if p_op is null or p_op not in ('insert', 'update', 'delete') then
    raise exception 'op is insert, update or delete, not %', p_op using errcode = 'invalid_parameter_value';
  end if;
  if p_surface is null or p_surface not in ('routine', 'scheduled') then
    raise exception 'a routine records its changes as routine or scheduled, not %', p_surface
      using errcode = 'invalid_parameter_value';
  end if;

  if p_op <> 'delete' then
    after_row := core.dash_subject_row(p_subject_ref);
    if after_row is null then
      raise exception '% is not there, so there is no change to record', p_subject_ref
        using errcode = 'no_data_found';
    end if;
  end if;

  if p_op <> 'insert' then
    before_row := coalesce(
      p_before,
      nullif(coalesce(nullif(current_setting('core.dash_before', true), ''), '{}')::jsonb -> p_subject_ref, 'null'::jsonb)
    );
    if before_row is not null and jsonb_typeof(before_row) <> 'object' then
      raise exception 'the row before is a whole row, as one object' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if coalesce(after_row, before_row) ? 'user_id'
     and (coalesce(after_row, before_row) ->> 'user_id') is distinct from p_user_id::text then
    raise exception '% belongs to another account', p_subject_ref using errcode = 'insufficient_privilege';
  end if;

  flat := btrim(regexp_replace(coalesce(p_summary, ''), '\s+', ' ', 'g'));
  if flat = '' then
    raise exception 'say what Dash did, in one sentence' using errcode = 'invalid_parameter_value';
  end if;
  if length(flat) > 300 then
    flat := rtrim(left(flat, 299)) || '…';
  end if;

  insert into core.dash_actions
    (user_id, surface, kind, status, done_at, subject_ref, op, before_values, after_values, summary)
  values
    (p_user_id, p_surface, p_kind, 'done', now(), p_subject_ref, p_op, before_row, after_row, flat)
  returning dash_actions.id into new_id;
  return new_id;
end;
$$;

revoke all on function core.dash_subject_row(text) from public, anon, authenticated;
revoke all on function core.dash_before(text) from public, anon, authenticated;
revoke all on function core.record_dash_action(uuid, text, text, text, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function core.dash_subject_row(text) to service_role;
grant execute on function core.dash_before(text) to service_role;
grant execute on function core.record_dash_action(uuid, text, text, text, text, jsonb, text)
  to service_role;

comment on function core.record_dash_action(uuid, text, text, text, text, jsonb, text) is
  'Record a change a routine just made to the person''s rows in core.dash_actions, as done, reading the row after from the ref (plan #1460).';
comment on function core.dash_before(text) is
  'Keep the row a ref names until the end of the transaction, as the before row for record_dash_action.';
comment on function core.dash_subject_row(text) is
  'The row a schema.table:id ref names, as jsonb, or null.';

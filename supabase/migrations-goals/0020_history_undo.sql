-- ===========================================================================
-- Undoing one of Claude's changes from a run's page (plan #1013).
--
-- Opening a run lists each change it made, read from goals.history by run_id,
-- and each of Claude's changes has an Undo. The undo is an ordinary write made
-- on your session, so the history trigger records it as yours. Two columns
-- say which change it took back:
--
--   history.undoes         the id of the history row the write undid
--   history.undoes_field   for a change to a collection's fields, the key of
--                          the one field it undid; null for any other change
--
-- The app sends them as the request headers x-goals-undo and
-- x-goals-undo-field, read the way the actor, capture and run already are
-- (0001), with the settings goals.undoes and goals.undoes_field for SQL run
-- directly. A value that is not a history id of the same account, or not a
-- field key, is dropped rather than refused, as a malformed capture or run id
-- is: the write goes ahead and the history row simply does not say what it
-- undid.
--
-- The run's page reads these to show a change as undone, and to tell your
-- undo apart from an edit you made by hand.
-- ===========================================================================

alter table goals.history add column undoes bigint;
alter table goals.history add column undoes_field text;

alter table goals.history
  add constraint history_undoes_fk foreign key (undoes)
    references goals.history (id) on delete cascade;
alter table goals.history
  add constraint history_undoes_field_ck check (
    undoes_field is null
    or (undoes is not null and undoes_field ~ '^[a-z][a-z0-9_]{0,39}$')
  );

create index history_undoes_idx on goals.history (undoes) where undoes is not null;

create or replace function goals.record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb;
  new_row jsonb;
  old_diff jsonb := '{}'::jsonb;
  new_diff jsonb := '{}'::jsonb;
  key text;
  owner uuid;
  row_id uuid;
  act text;
  who text;
  claims_role text;
  capture text;
  run text;
  undo_text text;
  undo_id bigint;
  undo_field text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    old_row := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new_row := to_jsonb(new);
  end if;

  owner := coalesce(new_row, old_row) ->> 'user_id';
  row_id := coalesce(new_row, old_row) ->> 'id';

  if tg_op = 'INSERT' then
    act := 'insert';
    old_diff := null;
    new_diff := new_row;
  elsif tg_op = 'DELETE' then
    -- A delete that is the account going away is not recorded: the history
    -- is going with it, and a row written now would point at a user who is
    -- already gone.
    if not exists (select 1 from auth.users u where u.id = owner) then
      return old;
    end if;
    act := 'delete';
    old_diff := old_row;
    new_diff := null;
  else
    for key in select jsonb_object_keys(new_row) loop
      if key <> 'updated_at' and (old_row -> key) is distinct from (new_row -> key) then
        old_diff := old_diff || jsonb_build_object(key, old_row -> key);
        new_diff := new_diff || jsonb_build_object(key, new_row -> key);
      end if;
    end loop;
    -- An update that changed nothing but the timestamp is not a change.
    if new_diff = '{}'::jsonb then
      return new;
    end if;
    if (old_row ->> 'archived_at') is null and (new_row ->> 'archived_at') is not null then
      act := 'archive';
    elsif (old_row ->> 'archived_at') is not null and (new_row ->> 'archived_at') is null then
      act := 'unarchive';
    else
      act := 'update';
    end if;
  end if;

  who := goals.request_value('goals.actor', 'x-goals-actor');
  if who is null or who not in ('me', 'claude', 'capture') then
    claims_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
    who := case when claims_role = 'authenticated' then 'me' else 'claude' end;
  end if;

  capture := goals.request_value('goals.capture_id', 'x-goals-capture');
  if capture !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    capture := null;
  end if;
  run := goals.request_value('goals.run_id', 'x-goals-run');
  if run !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    run := null;
  end if;

  -- The change this write undid, when it says so. Only a row of the same
  -- account counts, so a header cannot point at somebody else's history.
  undo_text := goals.request_value('goals.undoes', 'x-goals-undo');
  if undo_text ~ '^[0-9]{1,18}$' then
    select h.id into undo_id
      from goals.history h
     where h.id = undo_text::bigint and h.user_id = owner;
  end if;
  if undo_id is not null then
    undo_field := goals.request_value('goals.undoes_field', 'x-goals-undo-field');
    if undo_field !~ '^[a-z][a-z0-9_]{0,39}$' then
      undo_field := null;
    end if;
  end if;

  insert into goals.history
    (user_id, table_name, row_id, action, old_values, new_values, actor, capture_id, run_id,
     undoes, undoes_field)
  values
    (owner, tg_table_name, row_id, act, old_diff, new_diff, who, capture::uuid, run::uuid,
     undo_id, undo_field);

  return coalesce(new, old);
end;
$$;

revoke all on function goals.record_history() from public, anon, authenticated;

-- One record of every change Dash makes, from any surface (plan #1457).
--
-- docs/CORE-AND-DASH-SPEC.md, Part 5. core.dash_changes (0125, 0142) kept the
-- changes Dash proposed in Ask Dash. It is renamed core.dash_actions and made
-- general enough to hold every write Dash makes, wherever it came from, so
-- later steps can record the cover letter, comment actions and goal filing
-- (#1459), routines' writes (#1460), undo any of them by one rule (#1458) and
-- list today's on Home (#1461) without reshaping the table again.
--
-- What changes, column by column:
--
--   surface          new. Where the action came from: 'ask' (an Ask Dash
--                    answer), 'thread' (a reply in a comment thread),
--                    'capture', 'scheduled' (a run the app starts on a
--                    timer), 'routine' (a Claude Code routine writing
--                    through the connector). Every existing row is 'ask'.
--   conversation_id  now nullable. Ask and thread actions hang from their
--                    conversation; the other surfaces have none. An Ask
--                    action still must have one.
--   turn_id          unchanged: the turn that proposed or caused it.
--   kind             what was done, in snake_case. Ask keeps its four kinds,
--                    still checked here; other surfaces name their own.
--   input            unchanged: what Dash proposed. Defaults to {} for the
--                    surfaces that write straight away and propose nothing.
--   subject_ref      new, replacing written_table and written_ref. The row the
--                    action wrote or changed, as a ref (`schema.table:id`,
--                    Part 1). Existing rows are filled from the two columns
--                    it replaces. It carries no ownership check, unlike the
--                    refs in 0156: an action that deletes a row is recorded
--                    after the row has gone.
--   op               new. What happened to that row: 'insert', 'update' or
--                    'delete'. Filled for existing written rows from their
--                    kind: a return updates the inventory item, the other
--                    three insert a row.
--   before_values    new. The row's values before the action, as an object;
--   after_values     and after it. Null where there was no row (before an
--                    insert, after a delete). The undo rule of #1458
--                    restores before_values while the row still matches
--                    after_values. Existing Ask rows have neither: their
--                    undo is the per-kind check in lib/ask/changes.ts.
--   summary          new. The action in one sentence the person reads, for a
--                    surface whose kind has no wording in the app. Ask
--                    actions are worded from kind and input, and leave it
--                    null.
--   status           'confirmed' becomes 'done', which is what it meant: the
--                    write happened. proposed -> done | declined, and
--                    done -> undone, as before. A surface that acts straight
--                    away inserts its row as 'done'.
--   confirmed_at     renamed done_at.
--   undo             unchanged: what undoing needs beyond the row.
--
-- The one live row (a confirmed goal step) becomes a done action on
-- goals.items with op 'insert', and keeps its stamps.

set search_path = core, public, extensions;

alter table core.dash_changes rename to dash_actions;

-- The checks that name the old columns and statuses go first; they are
-- written again below in the new terms.
alter table core.dash_actions
  drop constraint dash_changes_kind_ck,
  drop constraint dash_changes_status_ck,
  drop constraint dash_changes_state_ck,
  drop constraint dash_changes_written_ck;

alter table core.dash_actions rename column confirmed_at to done_at;

alter table core.dash_actions
  add column surface text not null default 'ask',
  add column subject_ref text,
  add column op text,
  add column before_values jsonb,
  add column after_values jsonb,
  add column summary text,
  alter column conversation_id drop not null,
  alter column input set default '{}'::jsonb;

-- The guard refuses rewriting a confirmed row's written columns, so it is
-- held off while the existing rows are carried across.
alter table core.dash_actions disable trigger dash_changes_guard;

update core.dash_actions
set subject_ref = written_table || ':' || written_ref
where written_ref is not null;

update core.dash_actions
set op = case kind when 'mark_returned' then 'update' else 'insert' end
where subject_ref is not null;

update core.dash_actions set status = 'done' where status = 'confirmed';

alter table core.dash_actions enable trigger dash_changes_guard;

-- written_table and written_ref are read by nothing from here on. They stay
-- in the table for now: the connector holds a column removal for the
-- person's confirmation, so taking them off is a step of its own.

alter table core.dash_actions rename constraint dash_changes_pkey to dash_actions_pkey;
alter table core.dash_actions rename constraint dash_changes_user_id_fkey to dash_actions_user_id_fkey;
alter table core.dash_actions rename constraint dash_changes_conversation_fk to dash_actions_conversation_fk;
alter table core.dash_actions rename constraint dash_changes_turn_fk to dash_actions_turn_fk;
alter table core.dash_actions rename constraint dash_changes_input_ck to dash_actions_input_ck;
alter table core.dash_actions rename constraint dash_changes_undo_ck to dash_actions_undo_ck;

alter table core.dash_actions
  add constraint dash_actions_surface_ck
    check (surface in ('ask', 'thread', 'capture', 'scheduled', 'routine')),
  add constraint dash_actions_conversation_ck
    check (surface <> 'ask' or conversation_id is not null),
  add constraint dash_actions_kind_ck check (
    kind ~ '^[a-z][a-z0-9_]*$'
    and (surface <> 'ask' or kind in ('add_todo', 'add_goal_step', 'mark_returned', 'start_watch'))
  ),
  add constraint dash_actions_status_ck
    check (status in ('proposed', 'done', 'declined', 'undone')),
  add constraint dash_actions_subject_ck
    check (subject_ref is null or subject_ref ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*:\S'),
  add constraint dash_actions_op_ck
    check (op is null or op in ('insert', 'update', 'delete')),
  add constraint dash_actions_values_ck check (
    (before_values is null or jsonb_typeof(before_values) = 'object')
    and (after_values is null or jsonb_typeof(after_values) = 'object')
    and not (op = 'insert' and before_values is not null)
    and not (op = 'delete' and after_values is not null)
  ),
  add constraint dash_actions_summary_ck
    check (summary is null or btrim(summary) <> ''),
  -- Each state carries the stamps that got it there. Once written, an
  -- action names its row and what happened to it.
  add constraint dash_actions_state_ck check (
    case status
      when 'proposed' then done_at is null and declined_at is null and undone_at is null
      when 'declined' then declined_at is not null and done_at is null and undone_at is null
      when 'done' then done_at is not null and declined_at is null and undone_at is null
                       and subject_ref is not null and op is not null
      when 'undone' then done_at is not null and undone_at is not null and declined_at is null
                         and subject_ref is not null and op is not null
    end
  );

alter index core.dash_changes_conversation_idx rename to dash_actions_conversation_idx;
alter index core.dash_changes_user_created_idx rename to dash_actions_user_created_idx;
alter index core.dash_changes_turn_idx rename to dash_actions_turn_idx;

-- Every action on one row, for undo to see whether a later one moved it on.
create index dash_actions_subject_idx on core.dash_actions (subject_ref, created_at)
  where subject_ref is not null;

-- The guard, in the new terms. The moves are the same: confirm or decline a
-- proposal, undo a written action. What was proposed is fixed once proposed,
-- turn_id can only be filled in once, and what was written is fixed once the
-- action has left 'proposed'.
alter function core.dash_changes_guard() rename to dash_actions_guard;
alter trigger dash_changes_guard on core.dash_actions rename to dash_actions_guard;

create or replace function core.dash_actions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id <> old.user_id
     or new.surface <> old.surface
     or new.conversation_id is distinct from old.conversation_id
     or new.kind <> old.kind
     or new.input <> old.input
     or new.created_at <> old.created_at then
    raise exception 'a proposed change cannot be rewritten' using errcode = 'check_violation';
  end if;
  if old.turn_id is not null and new.turn_id is distinct from old.turn_id then
    raise exception 'a proposed change keeps the turn that proposed it' using errcode = 'check_violation';
  end if;
  if new.status <> old.status and not (
    (old.status = 'proposed' and new.status in ('done', 'declined'))
    or (old.status = 'done' and new.status = 'undone')
  ) then
    raise exception 'a change that is % cannot become %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  if old.status <> 'proposed' and (
    new.subject_ref is distinct from old.subject_ref
    or new.op is distinct from old.op
    or new.before_values is distinct from old.before_values
    or new.after_values is distinct from old.after_values
    or new.summary is distinct from old.summary
  ) then
    raise exception 'the row a change wrote cannot be changed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

alter policy dash_changes_all on core.dash_actions rename to dash_actions_all;

comment on table core.dash_actions is
  'Every change Dash made or proposed, from any surface, with the row it wrote and its values before and after: proposed, done, declined or undone (plan #1457, from core.dash_changes of #1187).';
comment on column core.dash_actions.surface is
  'Where the action came from: ask, thread, capture, scheduled or routine.';
comment on column core.dash_actions.kind is
  'What was done, in snake_case. Ask''s four kinds are checked; other surfaces name their own.';
comment on column core.dash_actions.input is
  'What Dash proposed, as the object the kind''s writer takes; {} for an action written straight away.';
comment on column core.dash_actions.subject_ref is
  'The row the action wrote or changed, as schema.table:id.';
comment on column core.dash_actions.op is
  'What happened to that row: insert, update or delete.';
comment on column core.dash_actions.before_values is
  'The row''s values before the action; null for an insert.';
comment on column core.dash_actions.after_values is
  'The row''s values after the action; null for a delete. Undo restores before_values while the row still matches these.';
comment on column core.dash_actions.summary is
  'The action in one sentence the person reads, for a kind the app has no wording for.';
comment on column core.dash_actions.undo is
  'What undoing needs beyond the subject row: for mark_returned, { "return_id": … }.';

notify pgrst, 'reload schema';

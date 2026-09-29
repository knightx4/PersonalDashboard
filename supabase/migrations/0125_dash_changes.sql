-- The changes Dash proposes from Ask Dash, and what became of each (plan #1187).
--
-- Feature #1186 lets Dash suggest a small change in an answer: add a todo, add
-- a step under a goal, or mark a to-return item returned. Nothing is written
-- until the person presses Confirm, and a confirmed change can be undone. A
-- proposal is only a row here until then. Keeping every one, with its state,
-- is what lets a card in an old conversation still show whether it was
-- confirmed, declined or undone (#1190), and gives the list of changes on the
-- Ask page something to read (#1191).
--
-- One row per proposed change; an answer can carry several, each confirmed
-- on its own.
--
--   conversation_id  the ask conversation the change was proposed in.
--   turn_id          Dash's turn that proposed it. Null until that turn is
--                    stored: the tool loop proposes before the answer is
--                    written, so the writer fills it in afterwards.
--   kind             'add_todo'       createTask behind addTask (app/todo)
--                    'add_goal_step'  insertStep (lib/goals/steps-store.ts)
--                    'mark_returned'  markItemReturned (app/shopping/returns)
--   input            what Dash proposed, as the object that kind's writer
--                    takes: the todo's title and date, the goal and the
--                    step's title, the inventory item.
--   status           proposed -> confirmed -> undone, or proposed -> declined.
--                    The trigger below refuses every other move, so a change
--                    that was declined or already confirmed cannot be
--                    confirmed again.
--   written_table    the row the confirm wrote or changed, as schema.table
--   written_ref      and its id: todo.tasks, goals.items, or
--                    public.inventory_items for a return.
--   undo             what undoing needs beyond that row, when it needs more:
--                    for a return, { "return_id": <the returns row id> }.
--
-- The rows it points at belong to their own modules and are sources there,
-- so this table is bookkeeping and has no foreign key into them: core is built
-- before the module schemas.
--
-- The conversation and turn are joined by composite keys with user_id, as
-- core.conversation_turns is (0104), so a change cannot hang from another
-- account's conversation: a plain foreign key is checked without RLS.

set search_path = core, public, extensions;

-- What the turn foreign key below points at.
create unique index if not exists conversation_turns_id_user_uq
  on core.conversation_turns (id, user_id);

create table core.dash_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  conversation_id uuid not null,
  turn_id uuid,

  kind text not null,
  input jsonb not null,
  status text not null default 'proposed',

  written_table text,
  written_ref text,
  undo jsonb,

  created_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz,
  declined_at timestamptz,
  undone_at timestamptz,

  constraint dash_changes_conversation_fk foreign key (conversation_id, user_id)
    references core.conversations (id, user_id) on delete cascade,
  constraint dash_changes_turn_fk foreign key (turn_id, user_id)
    references core.conversation_turns (id, user_id) on delete cascade,

  constraint dash_changes_kind_ck check (kind in ('add_todo', 'add_goal_step', 'mark_returned')),
  constraint dash_changes_status_ck check (status in ('proposed', 'confirmed', 'declined', 'undone')),
  constraint dash_changes_input_ck check (jsonb_typeof(input) = 'object'),
  constraint dash_changes_undo_ck check (undo is null or jsonb_typeof(undo) = 'object'),
  constraint dash_changes_written_ck check (
    (written_table is null) = (written_ref is null)
    and (written_ref is null or btrim(written_ref) <> '')
  ),
  -- Each state carries the stamps that got it there, and nothing written
  -- before a confirm.
  constraint dash_changes_state_ck check (
    case status
      when 'proposed' then confirmed_at is null and declined_at is null and undone_at is null
                           and written_ref is null
      when 'declined' then declined_at is not null and confirmed_at is null and undone_at is null
                           and written_ref is null
      when 'confirmed' then confirmed_at is not null and declined_at is null and undone_at is null
                            and written_ref is not null
      when 'undone' then confirmed_at is not null and undone_at is not null and declined_at is null
                         and written_ref is not null
    end
  )
);

-- The cards of a conversation, in the order they were proposed.
create index dash_changes_conversation_idx on core.dash_changes (conversation_id, created_at);
-- The list of changes on the Ask page, newest first.
create index dash_changes_user_created_idx on core.dash_changes (user_id, created_at desc);
create index dash_changes_turn_idx on core.dash_changes (turn_id) where turn_id is not null;

-- Only the moves the feature has: confirm or decline a proposal, undo a
-- confirmed change. The kind, input and conversation are fixed once proposed,
-- and turn_id can only be filled in, once.
create or replace function core.dash_changes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id <> old.user_id
     or new.conversation_id <> old.conversation_id
     or new.kind <> old.kind
     or new.input <> old.input
     or new.created_at <> old.created_at then
    raise exception 'a proposed change cannot be rewritten' using errcode = 'check_violation';
  end if;
  if old.turn_id is not null and new.turn_id is distinct from old.turn_id then
    raise exception 'a proposed change keeps the turn that proposed it' using errcode = 'check_violation';
  end if;
  if new.status <> old.status and not (
    (old.status = 'proposed' and new.status in ('confirmed', 'declined'))
    or (old.status = 'confirmed' and new.status = 'undone')
  ) then
    raise exception 'a change that is % cannot become %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  if old.status <> 'proposed' and (
    new.written_table is distinct from old.written_table
    or new.written_ref is distinct from old.written_ref
  ) then
    raise exception 'the row a change wrote cannot be changed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger dash_changes_guard
  before update on core.dash_changes
  for each row execute function core.dash_changes_guard();

alter table core.dash_changes enable row level security;

create policy dash_changes_all on core.dash_changes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on core.dash_changes from anon;
grant select, insert, update, delete on core.dash_changes to authenticated, service_role;

comment on table core.dash_changes is
  'A change Dash proposed in an Ask Dash answer and what became of it: proposed, confirmed, declined or undone (plan #1187).';
comment on column core.dash_changes.input is
  'What Dash proposed, as the object the kind''s writer takes.';
comment on column core.dash_changes.written_ref is
  'The id of the row the confirm wrote or changed, in written_table (schema.table).';
comment on column core.dash_changes.undo is
  'What undoing needs beyond the written row: for mark_returned, { "return_id": … }.';

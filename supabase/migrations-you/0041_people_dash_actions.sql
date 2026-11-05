-- The people on People act with Dash's own tools (plan #2854.2, under #2854).
--
-- A mentor, a council member or the builder can now add a todo, a goal, a
-- plan step and the rest of what Ask Dash does, in the thread they are
-- texting in. Each change is recorded in core.dash_actions exactly as one of
-- Dash's thread writes is (surface 'thread'), so Home lists it with its Undo
-- and Ask's per-kind undo puts it back. A build, a delete, a watch and a paid
-- press stay proposals there until the person confirms them.
--
-- core.dash_actions gains three columns saying who acted and where:
--
--   advisor_id          the person on People who made or proposed the change
--                       (you.board_advisors). Null for everything Dash itself
--                       does.
--   advisor_chat_id     the thread it was made in (you.advisor_chats), which
--                       the thread's cards read by.
--   advisor_message_id  the person's text it answered (you.advisor_messages),
--                       which a proposal's card hangs from in place of a
--                       conversation turn.
--
-- Each keeps the record if its row goes: the column alone is set null, so
-- the change and its Undo stay on Home after a thread or a person is removed.
--
-- In this folder rather than core's because the columns point at the you
-- schema, which is made after core.
--
-- Schema change only. No row of any account is written.

set search_path = core, public, extensions;

alter table core.dash_actions
  add column advisor_id uuid,
  add column advisor_chat_id uuid,
  add column advisor_message_id uuid,
  add constraint dash_actions_advisor_fk
    foreign key (advisor_id, user_id)
    references you.board_advisors (id, user_id) on delete set null (advisor_id),
  add constraint dash_actions_advisor_chat_fk
    foreign key (advisor_chat_id, user_id)
    references you.advisor_chats (id, user_id) on delete set null (advisor_chat_id),
  add constraint dash_actions_advisor_message_fk
    foreign key (advisor_message_id, user_id)
    references you.advisor_messages (id, user_id) on delete set null (advisor_message_id),
  -- Made by someone on People: always a thread record. (Not also "always
  -- names them": removing a person sets advisor_id null before the cascade
  -- from their chats reaches advisor_chat_id, and a check cannot wait.)
  add constraint dash_actions_advisor_ck check (
    (advisor_id is null and advisor_chat_id is null and advisor_message_id is null)
    or surface = 'thread'
  );

comment on column core.dash_actions.advisor_id is
  'The person on People who made or proposed this change (plan #2854.2); null when Dash did.';
comment on column core.dash_actions.advisor_chat_id is
  'The People thread the change was made in (plan #2854.2).';
comment on column core.dash_actions.advisor_message_id is
  'The person''s text in that thread the change answered; a proposal''s card hangs from it (plan #2854.2).';

create index dash_actions_advisor_chat_idx
  on core.dash_actions (advisor_chat_id, created_at)
  where advisor_chat_id is not null;

notify pgrst, 'reload schema';

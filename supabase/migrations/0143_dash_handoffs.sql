-- Requests Ask Dash handed to the backup routine (plan #1402).
--
-- When the person asks Dash for something none of its tools can do, Dash says
-- it has passed the request on, and a Claude Code routine does the work a few
-- minutes later. The routine writes its reply into the same conversation as a
-- Dash turn. This row is the request and what became of it, so the app can
-- show that a reply is coming, and the routine knows which request it is for.
--
--   conversation_id  the ask conversation the request was made in.
--   turn_id          Dash's turn saying it was handed on. Null until that turn
--                    is stored, as in core.dash_changes.
--   request          what the person asked for, in Dash's words, for the
--                    routine to act on.
--   status           pending  kept, routine not started yet
--                    fired    the routine was started (run_id names the run)
--                    done     the routine replied (reply_turn_id)
--                    failed   it could not be started or could not finish
--                             (error says why)
--   note_id          the feedback_items row the routine filed naming the
--                    ability Dash lacked, so it can be added to Dash itself.

set search_path = core, public, extensions;

create table core.dash_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  conversation_id uuid not null,
  turn_id uuid,

  request text not null,
  status text not null default 'pending',
  run_id text,
  error text,
  reply_turn_id uuid,
  note_id uuid,

  created_at timestamptz not null default clock_timestamp(),
  fired_at timestamptz,
  finished_at timestamptz,

  constraint dash_handoffs_conversation_fk foreign key (conversation_id, user_id)
    references core.conversations (id, user_id) on delete cascade,
  constraint dash_handoffs_turn_fk foreign key (turn_id, user_id)
    references core.conversation_turns (id, user_id) on delete set null (turn_id),
  constraint dash_handoffs_reply_fk foreign key (reply_turn_id, user_id)
    references core.conversation_turns (id, user_id) on delete set null (reply_turn_id),

  constraint dash_handoffs_status_ck check (status in ('pending', 'fired', 'done', 'failed')),
  constraint dash_handoffs_request_ck check (btrim(request) <> '' and char_length(request) <= 4000)
);

-- The open hand-offs of a conversation, for the "on it" line under the thread.
create index dash_handoffs_conversation_idx on core.dash_handoffs (conversation_id, created_at);
-- What the routine picks up when it was started without an id.
create index dash_handoffs_open_idx on core.dash_handoffs (user_id, created_at)
  where status in ('pending', 'fired');

alter table core.dash_handoffs enable row level security;

create policy dash_handoffs_all on core.dash_handoffs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on core.dash_handoffs from anon;
grant select, insert, update, delete on core.dash_handoffs to authenticated, service_role;

comment on table core.dash_handoffs is
  'A request Ask Dash could not do itself and handed to the backup routine, and what became of it (plan #1402).';

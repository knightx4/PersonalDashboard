-- Every Dash answer that failed, kept with its reason (plan #2937.2).
--
-- On 4 November 2026 a Think it through answer came back empty, and nothing
-- kept why: the chat said "Dash could not answer" and the daily health check
-- had no turn to count, since a failed answer writes none. Each failure is
-- now a row here, written by Ask (lib/dash/ask.ts), thread replies
-- (lib/dash/thread.ts) and the capture box (lib/goals/capture-model.ts).
-- The daily Dash quality run raises every row in its window, and the Dash
-- quality session reads them before thumbs down.
--
-- core.dash_failures, one row per answer that failed:
--   surface          'ask', 'thread' or 'capture'.
--   outcome          'failed' when no answer was written, 'unfinished' when
--                    what was kept was built from the model's notes or its
--                    lookups rather than written by it.
--   reason           why, as the loop said it.
--   model, effort    what was asked; effort is null when none was sent.
--   think            Think it through was on.
--   scope            the workspace an Ask question was kept to, so Try again
--                    can ask the same way.
--   conversation_id  the Ask Dash chat; null for a thread or a capture, or
--                    once the chat is deleted.
--   turn_id          the question's turn, when there is one.
--   subject_ref      the row a thread or a capture hangs from, schema.table:id.
--   calls            per model call: stop (stop reason), blocks (content
--                    block types), output_tokens, input_tokens,
--                    cached_input_tokens, cache_write_tokens, and error when
--                    the call threw.
--
-- Bookkeeping, append-only like core.connector_calls: the owner may read and
-- insert their own rows, nobody rewrites one. Schema only: no row is written
-- or changed here.

set search_path = core, public, extensions;

create table core.dash_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  surface text not null,
  outcome text not null,
  reason text not null,
  model text not null,
  effort text,
  think boolean not null default false,
  scope text,
  conversation_id uuid references core.conversations (id) on delete set null,
  turn_id uuid references core.conversation_turns (id) on delete set null,
  subject_ref text,
  calls jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default clock_timestamp(),

  constraint dash_failures_surface_ck check (surface in ('ask', 'thread', 'capture')),
  constraint dash_failures_outcome_ck check (outcome in ('failed', 'unfinished')),
  constraint dash_failures_reason_ck check (btrim(reason) <> '' and length(reason) <= 2000),
  constraint dash_failures_model_ck check (btrim(model) <> ''),
  constraint dash_failures_calls_ck check (jsonb_typeof(calls) = 'array')
);

-- The health check's window, newest first, and Try again's last failure in a chat.
create index dash_failures_user_created_idx on core.dash_failures (user_id, created_at desc);
create index dash_failures_conversation_idx on core.dash_failures (conversation_id, created_at desc)
  where conversation_id is not null;
create index dash_failures_turn_idx on core.dash_failures (turn_id) where turn_id is not null;

alter table core.dash_failures enable row level security;

create policy dash_failures_select on core.dash_failures for select to authenticated
  using (user_id = (select auth.uid()));
create policy dash_failures_insert on core.dash_failures for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke all on core.dash_failures from anon, authenticated;
grant select, insert on core.dash_failures to authenticated;
grant all on core.dash_failures to service_role;

comment on table core.dash_failures is
  'Each Dash answer that failed or came back unfinished, with its reason and each model call; the daily health check raises every one (plan #2937.2).';
comment on column core.dash_failures.calls is
  'Per model call: stop, blocks, output_tokens, input_tokens, cached_input_tokens, cache_write_tokens, and error when it threw.';

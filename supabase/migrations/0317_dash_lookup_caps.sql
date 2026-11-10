-- Each Ask Dash answer that stopped because it used all its lookups (plan #3092).
--
-- Ask Dash may make 12 lookups, and 6 more in the one extra stretch it is
-- given (lib/dash/loop.ts MAX_LOOKUPS, EXTRA_LOOKUPS). When it uses them all,
-- the answer is written from what those lookups found and stops with
-- 'lookups'. Eval case 62345130 did that after 59 seconds (run 72ff0ba5).
-- The cap stays at 12. Each such answer is a row here instead,
-- listed newest first on Dev (/dev/usage/lookups), so the owner can read what
-- the lookups were and decide, case by case, whether lookups should be done
-- differently or the question handed to a session.
--
-- core.dash_lookup_caps, one row per answer that ran out of lookups:
--   surface          'ask' for Ask Dash, 'eval' for a case the Dash quality
--                    check asked (lib/dash/quality/run.ts).
--   question         what was asked.
--   conversation_id  the Ask Dash chat; null for an eval case, or once the
--                    chat is deleted.
--   turn_id          the answer's turn, once it was kept.
--   page_path        the page the question was asked from, when it was.
--   scope            the workspace the question was kept to.
--   eval_run_id      the core.dash_eval_runs row, for an eval case.
--   eval_case_id     the core.dash_eval_cases row, for an eval case.
--   lookups          the lookups in the order made: [{ tool, input, ok }],
--                    input trimmed when long.
--   lookup_count     how many lookups were made.
--   extended         the answer had been given its one extra stretch.
--   cut_short        the answer was longer than a turn holds and its end was
--                    cut, or the model's last reply hit its length limit.
--   seconds          how long the answer took.
--   cost_micros      what its model calls cost, in millionths of a dollar;
--                    null when a model is not priced.
--   model            the model that answered.
--
-- Bookkeeping, append-only like core.dash_failures: the owner may read and
-- insert their own rows, nobody rewrites one. Schema only: no row is written
-- or changed here.

set search_path = core, public, extensions;

create table core.dash_lookup_caps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  surface text not null,
  question text not null,
  conversation_id uuid references core.conversations (id) on delete set null,
  turn_id uuid references core.conversation_turns (id) on delete set null,
  page_path text,
  scope text,
  eval_run_id uuid references core.dash_eval_runs (id) on delete set null,
  eval_case_id uuid references core.dash_eval_cases (id) on delete set null,
  lookups jsonb not null default '[]'::jsonb,
  lookup_count int not null default 0,
  extended boolean not null default false,
  cut_short boolean not null default false,
  seconds numeric(8, 1) not null default 0,
  cost_micros bigint,
  model text not null,

  created_at timestamptz not null default clock_timestamp(),

  constraint dash_lookup_caps_surface_ck check (surface in ('ask', 'eval')),
  constraint dash_lookup_caps_question_ck check (btrim(question) <> '' and length(question) <= 8000),
  constraint dash_lookup_caps_page_ck check (page_path is null or page_path like '/%'),
  constraint dash_lookup_caps_lookups_ck check (jsonb_typeof(lookups) = 'array'),
  constraint dash_lookup_caps_count_ck check (lookup_count >= 0),
  constraint dash_lookup_caps_seconds_ck check (seconds >= 0),
  constraint dash_lookup_caps_model_ck check (btrim(model) <> '')
);

-- The Dev list, newest first.
create index dash_lookup_caps_user_created_idx on core.dash_lookup_caps (user_id, created_at desc);
-- The foreign keys' own lookups when a chat, turn, run or case is deleted.
create index dash_lookup_caps_conversation_idx on core.dash_lookup_caps (conversation_id) where conversation_id is not null;
create index dash_lookup_caps_turn_idx on core.dash_lookup_caps (turn_id) where turn_id is not null;
create index dash_lookup_caps_eval_run_idx on core.dash_lookup_caps (eval_run_id) where eval_run_id is not null;
create index dash_lookup_caps_eval_case_idx on core.dash_lookup_caps (eval_case_id) where eval_case_id is not null;

alter table core.dash_lookup_caps enable row level security;

create policy dash_lookup_caps_select on core.dash_lookup_caps for select to authenticated
  using (user_id = (select auth.uid()));
create policy dash_lookup_caps_insert on core.dash_lookup_caps for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke all on core.dash_lookup_caps from anon, authenticated;
grant select, insert on core.dash_lookup_caps to authenticated;
grant all on core.dash_lookup_caps to service_role;

comment on table core.dash_lookup_caps is
  'Each Ask Dash answer that stopped because it used all its lookups, with the question, the lookups in order, time and cost; listed on Dev for review (plan #3092).';
comment on column core.dash_lookup_caps.lookups is
  'The lookups in the order made: [{ tool, input, ok }], each input trimmed when long.';

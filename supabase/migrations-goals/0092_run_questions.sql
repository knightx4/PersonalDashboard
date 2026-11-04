-- ===========================================================================
-- A piece of work handed to a goal from a chat, and the report back
-- (plan #2778.8).
--
-- Asking Ask Dash or a Claude chat to figure something out for a goal starts
-- a goals run on that goal (take_on_for_goal). The run row now keeps what was
-- asked and where from, so the goal's Dashboard can show the work while it
-- runs and the app can report back when it ends:
--
--   runs.question     what they asked, in their words. Null for every run
--                     started by a button or a schedule.
--   runs.origin       where the question came from: 'ask_dash' (the app's
--                     own chat), 'chat' (a Claude chat through the connector)
--                     or 'goal_page' (Ask Dash on the goal itself). Set
--                     exactly when question is.
--   runs.origin_ref   the Ask Dash conversation's id, which the reply line is
--                     written into; null for the other origins.
--   runs.reported_at  when the end was reported (the notification and, for
--                     Ask Dash, the reply line). The five-minute job sets it
--                     before sending, so two passes cannot both send.
--
-- What the run suggests is not written to the goal. It goes in
-- goals.suggestions with the run's id and waits on Add and No:
--
--   suggestions.kind  a seventh kind, 'tile': a dashboard tile the run
--                     suggests, added to items.dashboard on Add.
--   suggestions.tile  the tile itself, checked by lib/goals/dashboard.ts on
--                     Add. Set exactly when kind is 'tile'.
--
-- Schema only: no existing row is changed.
-- ===========================================================================

alter table goals.runs
  add column question text,
  add column origin text,
  add column origin_ref text,
  add column reported_at timestamptz;

alter table goals.runs
  add constraint runs_question_ck check (question is null or (btrim(question) <> '' and length(question) <= 4000)),
  add constraint runs_origin_ck check (origin is null or origin in ('ask_dash', 'chat', 'goal_page')),
  add constraint runs_origin_question_ck check ((origin is null) = (question is null)),
  add constraint runs_origin_ref_ck check (
    origin_ref is null or (origin = 'ask_dash' and length(origin_ref) <= 200)
  );

-- The five-minute read: question runs that ended and are not reported yet.
create index runs_question_report_idx on goals.runs (ended_at)
  where question is not null and reported_at is null;

alter table goals.suggestions drop constraint suggestions_kind_ck;
alter table goals.suggestions add constraint suggestions_kind_ck check (
  kind in ('events', 'volunteering', 'reading', 'courses', 'job_leads', 'step', 'tile')
);

alter table goals.suggestions add column tile jsonb;
alter table goals.suggestions add constraint suggestions_tile_ck check (
  (kind = 'tile') = (tile is not null) and (tile is null or jsonb_typeof(tile) = 'object')
);

comment on column goals.runs.question is
  'What the person asked Dash to figure out for the goal, in their words (plan #2778.8). Null for runs started by a button or a schedule.';
comment on column goals.runs.origin is
  'Where the question came from: ask_dash, chat (a Claude chat through the connector) or goal_page (plan #2778.8). Set exactly when question is.';
comment on column goals.runs.origin_ref is
  'The Ask Dash conversation the reply line goes into (plan #2778.8); null for other origins.';
comment on column goals.runs.reported_at is
  'When the end of a question run was reported by notification and reply line (plan #2778.8). The send-once guard.';
comment on column goals.suggestions.tile is
  'The dashboard tile a tile suggestion adds on Add (plan #2778.8), checked by lib/goals/dashboard.ts. Only kind tile has one.';
comment on column goals.suggestions.kind is
  'The kind of suggestion (plan #1028, #1734, #2778.8): events, volunteering, reading, courses, job_leads, step (becomes a step of the goal) or tile (becomes a tile on its dashboard).';

-- Interviews Dash holds to draft a workspace's vision and spec (plan #1638,
-- under feature #1637).
--
-- From the specs page the person starts an interview for a workspace or for
-- the app as a whole. Dash asks one question at a time, up to the interview's
-- question limit, and the person can ask for the drafts at any point. When it
-- ends Dash drafts a vision, as a pending edit in vision_reviews, and a spec,
-- as a proposed change in spec_changes.
--
-- One row here per interview. The questions and answers are not stored here:
-- they are the thread under the row, in core.conversations under the ref
-- `public.spec_interviews:<id>`, written with core.add_thread_turn (Dash's
-- question as 'claude', the person's answer as 'me'). So no thread table is
-- added (scripts/spec-counts.ts, thread-tables).
--
-- It holds what the person said about their own work, so it is a source for
-- Goals (lib/dev/sources.ts).

set search_path = public, extensions;

create table if not exists spec_interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The workspace, as its module id, or 'app' for the app as a whole: the
  -- same key as module_visions.module and vision_reviews.module.
  module text not null,
  -- open: being asked and answered, and can be picked up again. drafted: Dash
  -- has written the vision and spec it led to. abandoned: the person stopped
  -- it without drafts.
  status text not null default 'open',
  -- The most questions Dash asks before drafting. Twelve unless the setting
  -- says otherwise when the interview starts.
  question_limit integer not null default 12,
  -- When the person said "draft it now", or the last question was answered:
  -- the drafting run reads this and writes the drafts.
  draft_requested_at timestamptz,
  -- A few sentences Dash writes when it drafts, saying what the person told
  -- it. What Goals searches; the answers themselves are in the thread.
  summary text,
  -- What it drafted. Set null if the draft is later deleted, so the interview
  -- outlives its drafts.
  vision_review_id uuid references vision_reviews (id) on delete set null,
  spec_change_id uuid references spec_changes (id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint spec_interviews_module_not_blank_ck check (length(btrim(module)) > 0),
  constraint spec_interviews_status_ck check (status in ('open', 'drafted', 'abandoned')),
  constraint spec_interviews_question_limit_ck check (question_limit between 1 and 30),
  constraint spec_interviews_summary_length_ck check (length(summary) <= 4000),
  -- An open interview has not finished; a drafted or abandoned one has.
  constraint spec_interviews_finished_ck check ((status = 'open') = (finished_at is null))
);

-- One open interview per workspace, so starting one again resumes it.
create unique index if not exists spec_interviews_one_open_uq
  on spec_interviews (user_id, module) where status = 'open';

-- A workspace's interviews, newest first.
create index if not exists spec_interviews_user_module_idx
  on spec_interviews (user_id, module, started_at desc);

create index if not exists spec_interviews_vision_review_idx
  on spec_interviews (vision_review_id) where vision_review_id is not null;
create index if not exists spec_interviews_spec_change_idx
  on spec_interviews (spec_change_id) where spec_change_id is not null;

create trigger spec_interviews_touch_updated_at
  before update on spec_interviews
  for each row execute function public.touch_updated_at();

alter table spec_interviews enable row level security;

create policy spec_interviews_select on spec_interviews for select to authenticated
  using (user_id = (select auth.uid()));
create policy spec_interviews_insert on spec_interviews for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy spec_interviews_update on spec_interviews for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy spec_interviews_delete on spec_interviews for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on spec_interviews to authenticated;
grant all on spec_interviews to service_role;

comment on table spec_interviews is
  'One interview Dash holds to draft a workspace''s vision and spec (plan #1638). The questions and answers are the thread under the row in core.conversations, ref public.spec_interviews:<id>.';

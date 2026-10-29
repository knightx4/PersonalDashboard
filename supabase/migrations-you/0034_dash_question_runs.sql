-- The runs that write Dash's questions about the person (plan #2617.3).
--
-- The Answer tab of You has a button that asks Dash for new questions. Each
-- press queues one row here, the same shape as you.insight_runs: the goals
-- routine is fired with a brief naming the row, and the session that follows
-- .claude/skills/dash-questions/SKILL.md moves it to running and then to
-- ready or failed. summary is the run's account of what it read; run_url is
-- the session. One run at a time per person, so a second press while one is
-- going is refused by the partial unique index.
--
-- you.dash_questions gains run_id, the run that wrote a question (null for
-- one written any other way), and a trigger that refuses a sixth question
-- from the same run, so a run adds at most five.
--
-- Schema only: no rows are changed.

set search_path = you, public, extensions;

create table you.dash_question_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'queued',
  summary text check (summary is null or char_length(summary) <= 2000),
  error text check (error is null or char_length(error) <= 2000),
  run_url text check (run_url is null or char_length(run_url) <= 500),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint dash_question_runs_status_ck check (status in ('queued', 'running', 'ready', 'failed')),
  constraint dash_question_runs_id_user_id_key unique (id, user_id)
);

comment on table you.dash_question_runs is
  'Each run that wrote new questions from Dash for the Answer tab of You, with its state and summary (plan #2617.3).';

create index dash_question_runs_user_idx on you.dash_question_runs (user_id, requested_at desc);

-- One run at a time, so a second press does not start a second session.
create unique index dash_question_runs_one_running
  on you.dash_question_runs (user_id) where status in ('queued', 'running');

create trigger dash_question_runs_touch_updated_at
  before update on you.dash_question_runs
  for each row execute function you.touch_updated_at();

alter table you.dash_question_runs enable row level security;

create policy dash_question_runs_all on you.dash_question_runs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.dash_question_runs from anon, authenticated;
grant select, insert, update, delete on you.dash_question_runs to authenticated, service_role;

-- Which run wrote a question. The composite key keeps it to a run of the
-- same person.
alter table you.dash_questions add column run_id uuid;
alter table you.dash_questions
  add constraint dash_questions_run_fk foreign key (run_id, user_id)
  references you.dash_question_runs (id, user_id) on delete set null (run_id);
create index dash_questions_run_idx on you.dash_questions (run_id) where run_id is not null;

comment on column you.dash_questions.run_id is
  'The Dash run that wrote the question (you.dash_question_runs), at most five to a run; null when written any other way.';

-- At most five questions to a run.
create or replace function you.dash_questions_five_per_run()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.run_id is not null and (
    select count(*) from you.dash_questions q
     where q.run_id = new.run_id and q.user_id = new.user_id and q.id <> new.id
  ) >= 5 then
    raise exception 'A Dash run adds at most five questions.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger dash_questions_five_per_run
  before insert or update of run_id on you.dash_questions
  for each row execute function you.dash_questions_five_per_run();

notify pgrst, 'reload schema';

-- Check-backs: work a session means to come back to after some time.
--
-- A session that starts something slow (a scheduled run it wants to see the
-- result of, a queue it wants to watch drain, a change it wants to confirm
-- landed) had no place in the app to say "look at this again at 02:20". It
-- could only schedule a routine on the account, which nothing on the dashboard
-- can see and nobody else picks up if that session is gone. This is the place.
--
-- A row says what to check and when it is due. Two things pick it up:
--
--   **Whichever Dash session runs next.** `scripts/plan.ts raises`, which the
--   plan skill reads before anything else, says how many are due, and
--   `plan.ts check-backs` lists them. Dash runs often enough that this is how
--   most are done.
--
--   **The four-minute tick, when nothing did.** A check-back an hour past due
--   with `wake` on starts a session of its own (inngest/dev/check-backs.ts), at
--   most a few a day, and `woke_at` records that it was woken so it is not
--   woken twice.
--
-- `waiting` until a session closes it: `done` with what it found, or
-- `dropped` when it no longer matters. Due is not a status: it is `due_at`
-- having passed, so it needs no clock to set it.

set search_path = public, extensions;

create table if not exists check_backs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- One line: what to look at.
  title text not null,
  -- What to check, how to tell, and what to do about each answer.
  detail text,
  due_at timestamptz not null,
  -- The step it came from, when it came from one.
  plan_item_id uuid references plan_items (id) on delete set null,
  -- Who asked for it: a session link, "plan #1051", a person.
  source text,
  -- Whether the tick may start a session for it when none has picked it up.
  wake boolean not null default true,
  status text not null default 'waiting',
  -- What the check found, written when it is closed.
  outcome text,
  closed_at timestamptz,
  -- When the tick started a session for it, and that run.
  woke_at timestamptz,
  woke_run_id uuid references plan_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint check_backs_title_not_blank_ck check (length(btrim(title)) > 0),
  constraint check_backs_title_length_ck check (length(title) <= 200),
  constraint check_backs_detail_length_ck check (detail is null or length(detail) <= 4000),
  constraint check_backs_source_length_ck check (source is null or length(source) <= 300),
  constraint check_backs_outcome_length_ck check (outcome is null or length(outcome) <= 4000),
  constraint check_backs_status_ck check (status in ('waiting', 'done', 'dropped')),
  constraint check_backs_closed_ck check ((status = 'waiting') = (closed_at is null))
);

create index if not exists check_backs_waiting_due_idx
  on check_backs (user_id, due_at)
  where status = 'waiting';

drop trigger if exists check_backs_touch_updated_at on check_backs;
create trigger check_backs_touch_updated_at
  before update on check_backs
  for each row execute function public.touch_updated_at();

alter table check_backs enable row level security;

drop policy if exists check_backs_select on check_backs;
create policy check_backs_select on check_backs for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists check_backs_insert on check_backs;
create policy check_backs_insert on check_backs for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists check_backs_update on check_backs;
create policy check_backs_update on check_backs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists check_backs_delete on check_backs;
create policy check_backs_delete on check_backs for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on check_backs to authenticated;
grant all on check_backs to service_role;
revoke all on table check_backs from anon;

-- A session the tick starts for due check-backs is its own kind of run.
alter table plan_runs drop constraint if exists plan_runs_job_ck;
alter table plan_runs add constraint plan_runs_job_ck check (
  job in ('step', 'feature', 'queue', 'reshape', 'shape', 'notes', 'review', 'comment', 'raise', 'check_back')
);

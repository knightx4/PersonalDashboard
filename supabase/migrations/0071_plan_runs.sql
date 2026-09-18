-- Every routine run the dev pages start, and what Anthropic said back.
--
-- Pressing a dev button fires a routine and the app forgot it immediately: the
-- fire response was read for its status code and thrown away, so nothing knew
-- a run existed, what its identifier was, or whether it had ever started. Every
-- signal after the press was the step's own `status` column plus a clock, which
-- is why a step reads as underway hours after the session holding it died, and
-- why `lib/plan/claims.ts` has to guess with a two-hour threshold.
--
-- One row per press. The step it is about when it is about one -- the notes
-- queue, a UI review and shaping an idea are runs too and name no step -- plus
-- which button fired it, which routine took it, and the whole response body.
--
-- The body is kept verbatim rather than only the identifier picked out of it,
-- because nobody has yet seen what the fire endpoint returns. `external_id` is
-- a best guess read off the usual keys; `response` is what it actually said, so
-- reading liveness off it later is a question of looking rather than of firing
-- another run to find out.
--
-- A run that never started is a row too, with `status = 'failed'` and the
-- reason. The press that answered 401 and the press nobody made look the same
-- from the plan side otherwise, and they are not the same thing at all.
--
-- `plan_item_id` nulls rather than cascades on delete: a deleted step should
-- not take the record of the run that worked on it with it.

set search_path = public, extensions;

create table if not exists plan_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The step the run is about, when it is about one.
  plan_item_id uuid references plan_items (id) on delete set null,
  -- Which press started it: a step, a feature, the queue, a re-shape, shaping
  -- an idea, the notes queue, a UI review, or a comment asking for the code.
  job text not null,
  -- The routine that was fired, as the id the request was sent to.
  routine_id text,
  -- What names this run in the response body, when the body carried anything
  -- that looks like a name. Null is normal until it is known what it carries.
  external_id text,
  status text not null default 'started',
  -- What Anthropic answered with, as it came.
  http_status integer,
  response jsonb,
  -- Why it did not start. Null on a run that did.
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_runs_job_ck check (
    job in ('step', 'feature', 'queue', 'reshape', 'shape', 'notes', 'review', 'comment')
  ),
  constraint plan_runs_status_ck check (status in ('started', 'failed')),
  constraint plan_runs_routine_id_length_ck check (routine_id is null or length(routine_id) <= 200),
  constraint plan_runs_external_id_length_ck check (external_id is null or length(external_id) <= 200),
  constraint plan_runs_http_status_ck check (http_status is null or (http_status >= 100 and http_status < 600)),
  constraint plan_runs_error_length_ck check (error is null or length(error) <= 4000),
  -- A failure says why, and a run that started has nothing to explain.
  constraint plan_runs_error_matches_status_ck check (
    (status = 'failed' and error is not null) or (status <> 'failed' and error is null)
  )
);

-- The two questions asked of it: what has this account started lately, and
-- what was started on this step.
create index if not exists plan_runs_user_created_idx
  on plan_runs (user_id, created_at desc);
create index if not exists plan_runs_item_created_idx
  on plan_runs (plan_item_id, created_at desc)
  where plan_item_id is not null;

drop trigger if exists plan_runs_touch_updated_at on plan_runs;
create trigger plan_runs_touch_updated_at
  before update on plan_runs
  for each row execute function public.touch_updated_at();

alter table plan_runs enable row level security;

drop policy if exists plan_runs_select on plan_runs;
create policy plan_runs_select on plan_runs for select to authenticated
  using (user_id = (select auth.uid()));
-- The step check is in the policy rather than in a trigger, as in ui_findings:
-- the step is in `public` and readable under the same policy, so a run filed
-- against somebody else's step matches nothing and is refused.
drop policy if exists plan_runs_insert on plan_runs;
create policy plan_runs_insert on plan_runs for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      plan_item_id is null
      or exists (
        select 1 from plan_items p
        where p.id = plan_item_id and p.user_id = (select auth.uid())
      )
    )
  );
drop policy if exists plan_runs_update on plan_runs;
create policy plan_runs_update on plan_runs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists plan_runs_delete on plan_runs;
create policy plan_runs_delete on plan_runs for delete to authenticated
  using (user_id = (select auth.uid()));

-- Said out loud rather than left to the project's default privileges, for the
-- reasons 0050 spells out.
grant select, insert, update, delete on plan_runs to authenticated;

revoke all on table plan_runs from anon;

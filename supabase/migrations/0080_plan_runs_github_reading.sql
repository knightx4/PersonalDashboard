-- What GitHub last said about a run, kept on the run row.
--
-- `lib/plan/liveness.ts` can already ask GitHub what a run has pushed, but
-- nothing keeps the answer, so every surface has to ask again or fall back to
-- the clock -- and only the plan page is in a position to ask. #563 settled
-- that a small route does the asking and writes what it heard onto the run,
-- which is what these columns hold: the plan page, the terminal tool and a
-- freshly fired session then read one stored reading instead of each working
-- one out for itself.
--
-- `github_checked_at` is the column the rest hang off. A run nothing has asked
-- about has it null, and a run that was asked about and had pushed nothing has
-- it set with `last_push_at` null -- two facts that were indistinguishable
-- while silence was all that was stored. It is also what #570 compares against
-- the two-hour mark to decide whether a stored reading is still worth
-- believing.
--
-- `github_error` is separate from `error` on purpose. `error` is Anthropic
-- refusing the fire, and `plan_runs_error_matches_status_ck` ties it to
-- `status = 'failed'`; a rejected GitHub key says nothing about whether the
-- run started, so folding the two together would either break that constraint
-- or write off a healthy run. #566 reads its own state off this column.
--
-- Nothing writes any of them yet. The route that does is #569, and #500 reads
-- them as a health.

set search_path = public, extensions;

alter table plan_runs
  -- When GitHub was last asked what this run has pushed. Null until something
  -- has asked at all.
  add column if not exists github_checked_at timestamptz,
  -- The newest push the run had made when GitHub was asked, and which commit
  -- that was. Null together when it had pushed nothing.
  add column if not exists last_push_at timestamptz,
  add column if not exists last_push_sha text,
  add column if not exists last_push_subject text,
  -- Why GitHub refused, when it did: a missing or rejected key, or a repository
  -- it cannot see. Null on a request that answered.
  add column if not exists github_error text;

-- A push can only be known about by having asked, and a commit can only be
-- named by a push. Nothing may be stored the other way round, so a reader can
-- take `github_checked_at` as the one test of whether there is a reading here.
alter table plan_runs drop constraint if exists plan_runs_push_needs_check_ck;
alter table plan_runs add constraint plan_runs_push_needs_check_ck check (
  last_push_at is null or github_checked_at is not null
);

alter table plan_runs drop constraint if exists plan_runs_commit_needs_push_ck;
alter table plan_runs add constraint plan_runs_commit_needs_push_ck check (
  last_push_at is not null or (last_push_sha is null and last_push_subject is null)
);

alter table plan_runs drop constraint if exists plan_runs_github_error_needs_check_ck;
alter table plan_runs add constraint plan_runs_github_error_needs_check_ck check (
  github_error is null or github_checked_at is not null
);

-- Lengths, in the shape 0071 gives the rest of the table. A subject is a
-- commit's first line and a refusal is a sentence from GitHub; both are kept
-- short enough that a long one cannot make the row expensive to read.
alter table plan_runs drop constraint if exists plan_runs_last_push_sha_length_ck;
alter table plan_runs add constraint plan_runs_last_push_sha_length_ck check (
  last_push_sha is null or length(last_push_sha) <= 64
);

alter table plan_runs drop constraint if exists plan_runs_last_push_subject_length_ck;
alter table plan_runs add constraint plan_runs_last_push_subject_length_ck check (
  last_push_subject is null or length(last_push_subject) <= 500
);

alter table plan_runs drop constraint if exists plan_runs_github_error_length_ck;
alter table plan_runs add constraint plan_runs_github_error_length_ck check (
  github_error is null or length(github_error) <= 500
);

comment on column plan_runs.github_checked_at is
  'When GitHub was last asked what this run has pushed. Null until something has asked.';
comment on column plan_runs.last_push_at is
  'The newest push this run had made when GitHub was last asked. Null when it had pushed nothing.';
comment on column plan_runs.last_push_sha is 'The commit that push landed.';
comment on column plan_runs.last_push_subject is 'That commit''s first line.';
comment on column plan_runs.github_error is
  'Why GitHub refused the request, when it did. Not the same as `error`, which is Anthropic refusing the fire.';

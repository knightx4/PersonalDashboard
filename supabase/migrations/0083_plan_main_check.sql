-- What CI last said about the newest commit on main.
--
-- CI was only ever read by /dev/plan, and only about commits already attached
-- to closed steps: `refreshCommitChecks` asks GitHub which merge carried each
-- finished step and whether it passed. That answers "did the work I shipped
-- last week survive", and it answers nothing at all about the branch as it
-- stands right now -- so main sat red from 19:43 to 21:40 one night while the
-- overnight runner merged onto it twice more, and nothing anywhere said so,
-- because nobody had that one page open.
--
-- #639 puts the answer on the status line, which is on every page in the app.
-- That only works if the reading is already written down. The shell cannot ask
-- GitHub -- a request to somebody else's server on every page load of every
-- workspace is not a status line, it is an outage waiting for a rate limit --
-- so the overnight tick, which runs every four minutes and already holds
-- GITHUB_READ_TOKEN, reads it and stores it here, and the shell does one
-- primary-key lookup.
--
-- A table of its own because neither existing home fits. `plan_commit_checks`
-- is keyed by the commit a step recorded and exists to answer for work already
-- closed; main's head is not a step's commit and is a different row every time
-- it is asked. `plan_runs` is keyed per run and this belongs to no run -- the
-- whole point is that it is read on the ticks where nothing is running.
--
-- Keyed by repository rather than by account, and that is the honest shape:
-- whether main is green is a fact about knightx4/PersonalDashboard, not about
-- whoever is looking at it. A `user_id` here would mean the same sha and the
-- same conclusion written once per account, and two accounts disagreeing about
-- the colour of one commit -- which is a bug the column would invent. So the
-- row is readable by any signed-in user and writable by none of them; the
-- service role the cron runs as is the only writer, and it bypasses RLS.
--
-- No `created_at` or `updated_at`. This row is overwritten every four minutes
-- forever, so the first fact would be meaningless and the second is
-- `checked_at` under another name. `checked_at` is also what the status line
-- judges the reading's age against: a green dot left over from an hour ago is
-- a lie, so the shell greys out a reading it considers stale rather than
-- drawing it.
--
-- `error` is the #566 convention, kept: `lib/plan/ci.ts` `refusalFor` turns a
-- 401/403/404 into the sentence that names the permission the key is short of,
-- and that sentence is stored whole rather than a status code, because a
-- status code on a status line is HTTP repeated at somebody who never asked
-- GitHub anything.
--
-- `lib/plan/ci.ts` `refreshMainCheck` is the only thing that writes this row.

set search_path = public, extensions;

create table if not exists plan_main_checks (
  -- "owner/repo". One row, and the key says which repository it is about, so a
  -- second repository would be a second row rather than a second table.
  repo text primary key,
  -- Main's newest commit when it was asked about. Null only when GitHub would
  -- not say -- a missing key, or a refusal before the listing answered.
  head_sha text,
  -- What `lib/plan/checks.ts` `conclusionFrom` made of that commit's workflow
  -- runs. Null when the reading did not get that far, which is the one case
  -- `error` is guaranteed to be set in.
  conclusion text,
  -- When GitHub was asked. Written on every attempt, answered or refused, so
  -- the age of the reading is knowable even when the reading itself failed.
  checked_at timestamptz not null default now(),
  -- Why GitHub refused, in the sentence `refusalFor` writes. Null on a request
  -- that answered.
  error text,
  -- The four `CheckConclusion` values main's own head can take. `unmerged` is
  -- the fifth and cannot happen here: it means "nothing on main carries this
  -- commit", and this commit is main.
  constraint plan_main_checks_conclusion_ck check (
    conclusion is null or conclusion in ('passed', 'failed', 'running', 'none')
  ),
  -- A conclusion is about a commit. There is no way to know a branch passed
  -- without knowing what passed.
  constraint plan_main_checks_conclusion_has_commit_ck check (
    conclusion is null or head_sha is not null
  ),
  -- Every stored reading says something: what CI concluded, or why it could
  -- not be asked. A row with neither is a reading that took place and vanished,
  -- and it would draw as "not read yet" -- which is a different fact and the
  -- one thing this table exists to stop being indistinguishable from silence.
  constraint plan_main_checks_says_something_ck check (
    conclusion is not null or error is not null
  ),
  -- Lengths, in the shape 0071 and 0080 give the rest of the plan tables. A
  -- sha is forty characters and a refusal is a sentence; both are held short
  -- enough that a long one cannot make the row expensive to read on every page
  -- load in the app.
  constraint plan_main_checks_repo_length_ck check (length(repo) between 1 and 200),
  constraint plan_main_checks_head_sha_length_ck check (
    head_sha is null or length(head_sha) <= 64
  ),
  constraint plan_main_checks_error_length_ck check (error is null or length(error) <= 500)
);

comment on table plan_main_checks is
  'What CI last said about the newest commit on main, for the status line to draw. Written by the overnight tick, read by every page.';
comment on column plan_main_checks.head_sha is
  'Main''s newest commit when GitHub was asked. Null when GitHub would not say.';
comment on column plan_main_checks.conclusion is
  'passed | failed | running | none, from lib/plan/checks.ts. Null when the reading did not get that far.';
comment on column plan_main_checks.checked_at is
  'When GitHub was asked. Written on every attempt, so a stale reading can be told from a fresh one.';
comment on column plan_main_checks.error is
  'Why GitHub refused, in the sentence lib/plan/ci.ts refusalFor writes. Null on a request that answered.';

alter table plan_main_checks enable row level security;

-- Readable by anyone signed in, because it is not anybody's row: the state of
-- this repository's main branch is the same fact whoever is asking.
drop policy if exists plan_main_checks_select on plan_main_checks;
create policy plan_main_checks_select on plan_main_checks for select to authenticated
  using (true);

-- No insert, update or delete policy, deliberately. The cron's service role is
-- the only writer and it is not subject to RLS; a browser that could write this
-- row could paint main green while it is red, on every page, for the one reader
-- who most needs to know otherwise.

-- Said out loud rather than left to the project's default privileges, for the
-- reasons 0050 spells out -- and here the saying-out-loud has to take
-- something away as well as give it. The project grants `authenticated` all
-- four verbs by default, so a table with no insert policy is only unwritable
-- because RLS says no. That is one `alter table ... disable row level
-- security` away from being wrong, and this row is drawn on every page in the
-- app, so the privilege goes too: a browser cannot write it at either layer.
grant select on plan_main_checks to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table plan_main_checks from authenticated;

revoke all on table plan_main_checks from anon;

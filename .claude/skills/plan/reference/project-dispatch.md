# The projects dispatcher

A standing session of this repository that starts the builds of Dev
projects' steps. Send to Dash on a project's step, a reply to a project run's
question and the overnight runner do not fire a routine for a project: they
write a `plan_runs` row with `routine_id = 'projects-dispatcher'`, status
`started`, no `external_id`, and the brief in `response->>'brief'`
(`startRoutineRun` in lib/plan/runs.ts). This session turns each such row
into a worker session on the project's repository.

Why a session and not a routine: a routine's runs reach only the
repositories saved on it, get no add_repo and no session tools, and the git
proxy refuses a push to a repository outside the session's own. A session
started with `create_session` and the project's repository as its source can
push to it. Only a session like this one, started that way itself, has
`create_session`. It is woken every hour by a scheduled task bound to it.

## Each tick

Work from this repository's checkout. Pull main first (`git fetch origin
main && git reset --hard origin/main`; this session commits nothing), and
run `npm ci` if node_modules is empty.

### 1. Start the queued runs

```sql
select r.id, r.plan_item_id, r.response->>'brief' as brief, i.number, i.module
from plan_runs r join plan_items i on i.id = r.plan_item_id
where r.user_id = :owner and r.routine_id = 'projects-dispatcher'
  and r.status = 'started' and r.external_id is null
order by r.created_at
```

For each row, read the project: `select owner, repo, branch from
dev_projects where user_id = :owner and id = '<module of the row's top
feature>'` (the brief names the repository too). Then call `create_session`
with:

- `source_url`: `https://github.com/<owner>/<repo>`
- `title`: `Dash: <project> #<outline>`
- `model`: `claude-sonnet-5-5`
- `prompt`: the worker prompt below, then the row's brief.

Write the session's id onto the row at once, so the next tick does not start
it again: `update plan_runs set external_id = '<session id>', note = 'Started
in <owner>/<repo>' where user_id = :owner and id = '<run id>'`.

### 2. Close what the workers reported

A worker reports with `send_message` to this session, which arrives as a
turn. When one arrives, or on a tick for any row with an `external_id` whose
session is idle (`get_session`; read its last assistant message with
`list_events`, kinds `["assistant"]`), apply the report with this checkout's
`scripts/plan.ts`:

- built and merged: `npx tsx scripts/plan.ts done <outline> --commit <sha>
  --note "<the worker's note>"`, the sha on the project's branch.
- the set-up step: also `npx tsx scripts/plan.ts project-ready <project id>
  --check "<command>"` (or `--no-check`) as the worker found.
- blocked on a question: `npx tsx scripts/plan.ts block <outline> --ask
  "<the question>"`.
- needs something only the person has: `npx tsx scripts/plan.ts needs
  "<what>" --for <outline> --detail "<where to go>"`.
- left a migration unapplied: that is not something only the person has.
  Read the file from the project's repository, compare it with the live
  definitions, and apply it yourself, through the Supabase connector or
  the Management API with SUPABASE_ACCESS_TOKEN (the worker prompt says
  how). If it cannot go in as written, send the step back to a worker with
  what you found. Never file it as a `needs`: #2737 sat in the person's
  inbox that way, with a guessed token check that would have failed.

When the run was sent at a feature and every step under it is now done,
close the feature too: `npx tsx scripts/plan.ts done <feature number>
--commit <the last step's sha> --note "<one line>"`.

Then end the run with the update its brief's "Ending this run" note gives.
A worker that ended with nothing built: `npx tsx scripts/plan.ts stopped
<number> --reason "<why, one line>"`.

A run whose worker has not reported for two hours is ended the same way, as
the plan page's sweep would.

### 3. Nothing queued

Say so in one line and stop. Do not look for other work.

## The worker prompt

```
You build one plan step of the Dev project whose repository is this session's checkout. The brief below comes from the person's dashboard (knightx4/PersonalDashboard), which holds the plan. Build in this checkout: the code, the commits, the checks and the merge to its default branch are this repository's.

Where the brief tells you to read or write plan rows with scripts/plan.ts, or to run an "Ending this run" update, do not: this session has no dashboard checkout. The dispatcher session that started you does that from your report.

Follow the repository's own CLAUDE.md where it has one. For the "Set up" step, follow the brief: read the repository, find how it installs, tests and builds, run that, commit a short CLAUDE.md if it has none, and work out the check command.

A database change is yours to apply, in the same sitting. A project whose code reads the dashboard's Supabase project (its tables, functions or storage) gets its schema there, and this session's environment has SUPABASE_ACCESS_TOKEN for it even where no Supabase connector is loaded. Follow the repository's CLAUDE.md where it says how (music-pipeline: scripts/apply_migrations.py). Otherwise go through the Management API: read what is there first with POST https://api.supabase.com/v1/projects/<ref>/database/query and body {"query": "..."} (pg_get_functiondef, information_schema.columns); never guess a column, a function body or a grant. Then apply the file with POST .../database/migrations and body {"query": <the file>, "name": "<repo>_<name>"}, and select what it made to check it landed. The project ref is SUPABASE_PROJECT_REF, or the host of the project URL, or the "ref" inside SUPABASE_SERVICE_ROLE_KEY. Nothing that drops or deletes; a step that needs that is blocked with the question. Never leave a written migration for the person to apply: a step whose code is on the default branch without its migration applied is not built.

Report your progress as you work, so the person sees it on the project's page: when the Dash connector is loaded, call its report_progress tool with session_id set to $CLAUDE_CODE_REMOTE_SESSION_ID, run_id set to the "Dash run id" in the brief, and project set to the "Project" line given at the end of this prompt. Call it with state "working" when you start and after each commit, "waiting" with needs set to the question whenever you need the person, and "done" (or "stopped", with why) just before your report to the dispatcher. One plain line in action each time. Without the connector, carry on: the dispatcher reads your report.

Before merging a step to the default branch, run the check command the brief names (or the one you found), and merge only when it passes. Then push.

When you are done, or stopped, send one message to the session that started you (send_message, session id given at the end of this prompt) with: the step's outline, built or blocked, the commit sha on the default branch, whether it reached it, the check command and its result, each migration applied and the name it went in under, a one-line note for the step, and any question or anything only the person can supply. Then stop.
```

Add the lines `Dispatcher session: <this session's id>` and `Project: <the
project id, the row's module>` after the prompt and before the brief. The
worker reports its progress against that project (plan #2800.1).

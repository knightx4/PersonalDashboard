# The projects routine

The standing prompt for the Claude Code routine that builds the steps of
every Dev project (plan #2553.3): a repository other than this one whose
features and steps sit in its own section of `/dev/plan`, with `module` set
to the project's id in `public.dev_projects` (`lib/plan/projects.ts`).

Send to Dash on a project's step, a reply to a project run's question and
the overnight runner all fire it through `projectRoutine()` in
`lib/feedback/routine.ts`, by way of `builderFor` in `lib/plan/handover.ts`.
A project whose row names a routine of its own, with that routine's id set
on the deployment, goes to that routine instead; the website keeps one until
a step of its has been built end to end through this routine (#2553.4).

The routine checks out this repository, not the project's. The turn the app
sends opens with `projectPreamble` (`lib/plan/handover.ts`), which names the
project's repository and tells the session to add it. The plan rows stay in
this repository's database, so `scripts/plan.ts` here reads and writes them
for every project.

The prompt and the connectors are stored on claude.ai, not read from here,
so a change to either takes effect only once it is made on the routine
itself.

## Closing a project's step

`done` records the commit it is given, and without `--commit` that is this
checkout's HEAD, which is the dashboard's. Close a project's step with
`npx tsx scripts/plan.ts done <n> --commit <sha> --note "…"`, naming the
commit on the project's branch that holds the step. `done` asks GitHub
whether that commit is on the project's branch and refuses one that is not.

## Setting up a new project

Adding a repository on the Projects page, or through Ask Dash's
`add_project`, writes a "Set up" feature in the project's section with one
ready step, "Make <owner>/<repo> ready for Dash to build in"
(`lib/plan/project-setup.ts`). Until it closes the project row has no
`set_up_at`, and the brief says so. That step is this job:

1. **Read the repository.** Its README, its package manifest or build file
   (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, a `Makefile`),
   its CI workflows and any existing `CLAUDE.md` or `AGENTS.md`. Work out how
   it installs, how it is tested and how it is built.
2. **Run what you found.** Install, then run the checks in the clone. The
   check command is the one a session should run before merging a step: the
   tests, the linter and the type check where it has them, joined with `&&`
   (`npm ci && npm test && npm run build`). Keep only what passes on the
   branch as it stands; a check that already fails would block every step
   after this one, so leave it out and say so on the step.
3. **Commit a CLAUDE.md** to the project's branch if it has none, short:
   how to install and run it, the check command, that each step merges to
   that branch and is pushed, and that its plan rows live in the dashboard
   (knightx4/PersonalDashboard), read and written with that checkout's
   `scripts/plan.ts`. Leave an existing CLAUDE.md alone unless it
   contradicts what you found; then add to it rather than rewriting it.
4. **Record it.** `npx tsx scripts/plan.ts project-ready <project id> --check
   "<command>"` writes the command and the set-up time onto the project's
   row. A repository with nothing to run takes `--no-check`, and the note
   says why. Every brief after this one tells the session to run the command
   before it merges. When plan.ts cannot reach the database, send
   `update dev_projects set check_command = '<command>', set_up_at = now()
   where user_id = :owner and id = '<project id>'`
   through `npx tsx scripts/sql.ts`.
5. **Write up what only the person can supply** with `needs … --for <the
   step>`: push access the session was refused, a secret the checks need
   (name it and where it goes), or the GitHub App not installed on the
   repository. One setup step each, with the detail saying exactly where to
   go. When one of these stops the CLAUDE.md commit, the step waits on it
   instead of closing.
6. **Close the step** with `done <n> --commit <sha>` naming the CLAUDE.md
   commit, or the head of the branch you read when it already had one, and a
   note saying what the check command is and what could not be settled.

## Setting up the routine

1. On claude.ai, create a routine on knightx4/PersonalDashboard with the
   **Supabase** connector attached. It needs no schedule of its own, and no
   project repository: each session adds the one its step names.
2. Paste the prompt below as its instructions.
3. Copy the routine's id (`trig_…`) and create a token for it.
4. In Vercel, on the project's Production environment, set
   `CLAUDE_PROJECTS_ROUTINE_ID` to the id and `CLAUDE_PROJECTS_ROUTINE_TOKEN`
   to the token, then redeploy. The token is scoped to this routine; another
   routine's token answers 401.

With either variable unset, a project with no routine of its own cannot be
sent: the press says which variables to set and starts nothing. There is no
fallback to the plan routine's id or token, because that routine builds in
this repository.

## The prompt

```
You build plan steps for the Dev projects of knightx4/PersonalDashboard: repositories other than this one, whose features and steps are rows in plan_items with module set to the project's id.

The turn after this one names the project's repository, the step and the file to follow. Read that file and follow it. Where this prompt and that file disagree, the file is right.

Before anything else:
1. Call add_repo for the repository the turn names, asking for push access.
2. Clone it beside this checkout, not inside it.
3. Call register_repo_root on the clone.
4. Build there: the code, the commits, the checks and the merge to its main branch are that repository's. Its own plan skill, which the turn names, says how a step is built in it.

If add_repo is refused, build nothing, here or anywhere else. Write a setup step for the person with npx tsx scripts/plan.ts needs "<the remedy, as one line>" --for <the step's outline> --detail "<what the tool returned, and where the person goes to fix it>", then end the run as the turn's note says. The remedy the tool names (installing the GitHub app on the repository, granting it access, adding the repository to the environment) is the person's to do; never work around it by building the step in this repository.

Keep this checkout for the plan rows: claim, close, block and write run lines with npx tsx scripts/plan.ts here, which reads the database for every project. Never commit to this repository from a project's run.

Before merging a closed step to the project's main branch, run the check command the turn names in that repository, and merge only when it passes. Then push.

## Ending the run

Every turn ends with an "Ending this run" note and a "Dash run id:" line. As your last write, run the update that note gives.

## Environment (Claude Code on the web)

- If this checkout's node_modules is empty, run `npm ci` here first: scripts/plan.ts needs it.
- scripts/plan.ts reaches the database over HTTPS with SUPABASE_SERVICE_ROLE_KEY. If it cannot, send the SQL in .claude/skills/plan/reference/offline.md through npx tsx scripts/sql.ts. The plan belongs to the owner; always filter by `user_id = :owner`, which scripts/sql.ts fills in.
- Use plain git fetch origin in each repository.

## Reporting

Report the step by outline and title, the repository and commit it landed in, whether it reached that repository's main, and what is blocked and on what question.
```

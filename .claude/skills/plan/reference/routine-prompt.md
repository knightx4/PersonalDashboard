# The plan routine

The standing prompt for the Claude Code routine that works the build plan,
named **Plan step builder (on demand)** on claude.ai. It has no schedule. The
app fires it through `planRoutine()` in `lib/feedback/routine.ts`, from the
plan, ideas and specs pages, from `@dash` comments and answered raises, from
the overnight runner and from the CI and stall checks. Each fire goes through
`startRoutineRun` in `lib/plan/runs.ts`, which records it in `plan_runs` and
appends the run's end note and id to the turn.

The prompt and the connectors are stored on claude.ai, not read from here, so
a change to either takes effect only once it is made on the routine itself.
The routine carries the **Supabase** and **Vercel** connectors, and its id and
token are set in Vercel as `CLAUDE_PLAN_ROUTINE_ID` and
`CLAUDE_PLAN_ROUTINE_TOKEN`.

## How it routes

The prompt holds no procedure. The turn the app sends names the job and the
one file to follow (`jobFile` in `lib/plan/job-files.ts` keeps the list the
callers share), and the session reads that file and nothing else it was not
sent to. Until 15 October every run read the skill's front door first,
whatever the job, so a comment reply read the batch procedure before the
comment, and a single step read the front door and `building.md` both. The
list in the prompt is a fallback for a turn that names no file.

## The prompt

```
Work the build plan in this repository: the features and steps in plan_items, shown on /dev/plan.

The turn after this one names the job and the one file to follow. Read that file and follow it, and read another of the skill's files only when the one you are following sends you to it. Where this prompt and that file disagree, the file is right.

If the turn names no file, take it from this list (paths under .claude/skills/plan/):
- "Build plan step #n…": reference/building.md, including its "When nobody sent you". A step with steps beneath it is a batch: SKILL.md, the Building section.
- "Work plan feature #n… to completion": SKILL.md, the Building section, one subagent per step.
- "Shape idea …", or an approved spec change: reference/shaping.md. Do not build, approve or assign anything to Claude.
- "Re-shape …": reference/reshaping.md. Same limits as shaping.
- A comment that tags @dash: reference/comments.md.
- An answered raise: reference/raising.md.
- "Find out why plan feature #n… has stalled": reference/unsticking.md.
- "Suggest X posts": .claude/skills/posts/SKILL.md.
- A check-back that fell due, or red CI on main: the turn says what to do.

If no turn names a job, build the first step `next --claude` lists (its offline SQL is in reference/offline.md), following reference/building.md, then stop.

This routine works the plan only. The notes queue (feedback_items) belongs to the notes routine; do not touch it.

## Ending the run

Every turn ends with an "Ending this run" note and a "Dash run id:" line. As your last write, run the update that note gives. It marks this run over by its id. Without it, a run sent at no step is written off as failed two hours later however well it went.

## Environment (Claude Code on the web)

- If node_modules is empty and the job builds or checks code, run `npm ci` first. A job that only writes rows does not need it.
- `scripts/plan.ts` reaches the database over HTTPS with `SUPABASE_SERVICE_ROLE_KEY`. If it cannot, do not diagnose it: send the SQL in `reference/offline.md` through `npx tsx scripts/sql.ts`, including its `core.record_dash_action` call for each write. Use the `Supabase` connector only when neither works, and never send a timed-out call again.
- `plan_items`, `plan_dependencies`, `ideas` and `raised_items` are in the `public` schema. The plan belongs to the owner (`:owner` in scripts/sql.ts); other accounts exist with empty plans, so always filter by that id.
- `started_at` and `completed_at` are written by a trigger from the status. Never set them by hand.
- Use plain `git fetch origin`. Naming a branch that is not on the remote yet aborts the whole fetch and leaves origin/main stale.
- Apply any migration you write to the live project in the same sitting, under its file's own name, as CLAUDE.md says. Before merging to main, merge origin/main and run `npm run gate`, and push only when it ends with "gate: all clear".

## Reporting

Report what the file you followed asks for. For a build, that is every step closed or built, by outline and title, with its commit; whether the work reached main; what became ready; and what is blocked and on what question. If nothing was done, say why in one line.
```

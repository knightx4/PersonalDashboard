# Reporting progress while you work

Every session working for the person says what it is doing as it goes, so the
project page and Dev can show it within a minute (plan #2800). Without it the
app guesses from git pushes whether a session is alive.

A report rewrites one row in `core.session_progress`: the session's row for
the step it is on (or its one row, when it is on no step). Each report replaces
the last, so send the whole current picture each time.

## When to report

1. **When you start**: `working`, with what you are about to do.
2. **After each step you build or commit**: `working`, with what you just did
   ("Committed the export page").
3. **When you stop for the person**: `waiting`, with what you need in
   `needs`, written so they can act on it from a phone: the question and its
   options, or the job only they can do. Report `working` again once you
   carry on.
4. **When you finish**: `done`, with what you shipped. A session that ends
   without finishing reports `stopped`, with why.

A `waiting` report reaches the person within a minute as a row in the Goals
Inbox and a push to their phone (plan #2800.4), and only that state does. Their
answer comes back through the way your report names: `thread_id` (read it with
`read_thread`) or the plan run (`plan.ts response <n>`). A report with neither
is listed but cannot be answered from the Inbox, so give one.

One line each, in the writing guide's plain words. An action is cut at 300
characters.

## How

**With the Dash connector loaded** (its tools are `mcp__Dash__*`, or however
the client names the Dash connector), call `report_progress`:

- `session_id`: your session's id, the value of `$CLAUDE_CODE_REMOTE_SESSION_ID`
  (`cse_…`).
- `state`: `working`, `waiting`, `done` or `stopped`.
- `action`: the line.
- `needs`: only with `waiting`.
- `run_id`: the plan run you were sent as, when the brief names one (its
  "Dash run id" line). The step is taken from the run.
- `thread_id`: the session thread you answer in, when you were started from
  one.
- `project`: the Dev project's id (`music-pipeline`), when you work in a
  project's repository rather than the dashboard's.

**In this repository without the connector**, the same write goes through
`scripts/plan.ts`, which finds the run and your session id itself:

```
npx tsx scripts/plan.ts progress <n> --state working --action "Claimed #<n>"
npx tsx scripts/plan.ts progress <n> --state waiting --action "Asked which shape" --needs "CSV or JSON for the export?"
npx tsx scripts/plan.ts progress <n> --state done --action "Committed abc1234: Add the export page"
```

A report that fails says why (a run or project not in the account, a wait
with nothing needed). Fix that and carry on; a failed report never stops the
work.

## Session threads

A session started from a session thread (feature #2789) reports the same way,
always with `thread_id` and, on a project, `project`: `working` when it picks
up a message, `waiting` with the question whenever it has asked one through
`reply_in_thread`, and `done` when the thread's work is finished. The thread
session's prompt (#2789.6) carries this paragraph.

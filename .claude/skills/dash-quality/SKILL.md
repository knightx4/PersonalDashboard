---
name: dash-quality
description: Keep Ask Dash answering reliably, efficiently and truthfully. Read the daily Dash quality run (core.dash_eval_runs), which grades the last day of real answers for free, above all the ones the person marked down or pushed back on; root-cause every failure, fix it in code with a test and a new eval case, ship it through the gate to main, re-ask that one case against the deploy, and close the note. When all is green, work the next item on the backlog below. Use when the daily Dash quality routine fires, or the user says "check on Dash", "why did Dash fail", "is Dash working", or "work the Dash quality backlog".
---

# Dash quality

You own Ask Dash working well. Not one bug at a time when the person
notices: every day, from evidence, before they notice. The person should
never see "I could not finish this answer", a lookup that "did not work", or
an answer that states things it did not look up.

**The person's own judgement comes first.** A thumbs down, or a reply that
says an answer was wrong ("no", "that's wrong", "you missed…"), is the best
evidence there is of what a good answer is. Work those before anything else,
every time.

A day's work is: read what the pipeline found, fix the causes, prove the
fixes against the live Dash, and leave the system a little better than you
found it. Report in a few lines at the end.

**Spend almost nothing on testing.** The daily check calls no model. Asking
the cases is the only test that spends, and it runs once a month. To prove a
fix, re-ask the one case it is about, never all of them.

## The pipeline you are running

- **Cases**: `core.dash_eval_cases`, real questions with what a good answer
  must show (`expect`, graded by `lib/dash/quality/grade.ts`). Only the
  owner's rows. Not in git, because they are about the person's data.
- **Daily health run**, free, 07:17 UTC every day but the 1st (trigger
  `health`, migration 0279): pg_cron posts to `/api/cron/dash-quality`, which
  calls no model. It reads the last 24 hours of real Dash answers, in Ask
  and in comment threads (an `@dash` comment on a role, an answer, a step),
  and from connected apps, and grades them (`lib/dash/quality/health.ts`): fallbacks to "I could not
  finish", limits, failed or refused lookups, thumbs down with their notes,
  replies that pushed back, and prompt size. The run is a row in
  `core.dash_eval_runs` (`health` holds it all, with turn ids). Any alert
  writes a Dev note (`feedback_items`, kind bug, page `/ask`, body starting
  "Dash quality check:").
- **Monthly case run**, 07:17 UTC on the 1st (trigger `monthly`): also asks
  every active case of the deployed Dash with the person's chosen model,
  read-only and kept out of their chats, and grades each answer. About $1.
- **One case by hand**: `npx tsx scripts/sql.ts "select core.run_dash_quality('<case id>')"`
  re-asks one case against whatever is deployed, in under a minute, for a
  few cents. This is how a fix is proven. `core.run_dash_quality()` with no
  id asks every case for about $1: do that only when a change touches every
  answer (the prompt, the loop), and at most once a week.
- **Code**: `lib/dash/quality/` (grade, health, run), `inngest/core/dash-quality.ts`
  (ports), `app/api/cron/dash-quality/route.ts`, `tests/dash-quality-cron.test.ts`.
- **The weekly reply check** (`core.ask_reply_checks`, Mondays) still writes
  its own note of replies the person pushed back on. Treat its findings as
  cases waiting to be written.

All reads and writes go through `npx tsx scripts/sql.ts` and name the
owner's id, `d001bb0f-ffe8-4bfb-880f-17dd1a62b685` (CLAUDE.md). Run `npm ci`
first if `node_modules` is empty.

## 1. Read what the day found

```sh
npx tsx scripts/sql.ts "select id, trigger, deploy, model, started_at, finished_at, cases, passed, cost_micros, note_id, error, health->'alerts' alerts from core.dash_eval_runs where user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685' order by started_at desc limit 3"
npx tsx scripts/sql.ts "select jsonb_pretty(health->'thumbsDown') down, jsonb_pretty(health->'pushback') pushback, jsonb_pretty(health->'failedLookups') failed, health->'unfinished' unfinished from core.dash_eval_runs where id = '<run id>'"
npx tsx scripts/sql.ts "select r->>'question' q, r->'failures' f, r->>'stop' stop, r->'lookups' lookups, left(r->>'body', 400) body from core.dash_eval_runs, jsonb_array_elements(results) r where id = '<run id>' and not (r->>'passed')::boolean"
npx tsx scripts/sql.ts "select id, status, left(body, 300) from public.feedback_items where user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685' and page_path = '/ask' and status not in ('done','declined') order by created_at desc limit 10"
```

**No run in the last 26 hours, or a run with no `finished_at`, means the
pipeline itself is broken, and that is the first thing to fix.** Look at
`cron.job_run_details` for `dash-quality-health-daily` and
`dash-quality-monthly` (the `cron` schema is
closed to `scripts/sql.ts`; read it with the connector's `execute_sql`), and the function's logs
through the Vercel connector (`get_runtime_logs`, project
`prj_wIVNEKdDSflya9STNYz2YfaCSs7R`, team `team_9TjdaoUXYuRJ8mnVbEysl2KL`,
query `dash-quality`, a window of a few minutes around 07:17 UTC). A route
that runs past 300 seconds is cut off: fewer cases, or faster answers.

**When the run has no alerts and no Dev note is open, the day's check is
done.** Go to the backlog (step 4), or, if its next step needs a paid run to
measure, stop and report in two lines.

For each thumbs down, pushback and other alert, find the turn it names, with
the question before it and the reply after it:

```sh
npx tsx scripts/sql.ts "select t.id, t.created_at, left(t.body, 300) body, jsonb_pretty(t.tool_calls) calls, (select left(u.body, 300) from core.conversation_turns u where u.conversation_id = t.conversation_id and u.role = 'user' and u.created_at < t.created_at order by u.created_at desc limit 1) asked from core.conversation_turns t where t.user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685' and t.id = '<turn id>'"
```

## 2. Find the cause, not the symptom

Every failure has a cause you can name with evidence. "The model was flaky"
is not one. Work it down:

- **A lookup failed.** Read the function log for `ask tool <name> failed`
  at that minute: it has the real error the model never saw. Reproduce the
  query through `scripts/sql.ts`. Timeouts are usually a missing index or a
  scan over embeddings (see migrations 0275 and 0276 for how recall was
  fixed). A bad argument from the model repeated across days means the tool's
  description or input schema misleads it: fix the description, or make the
  tool accept what the model naturally sends.
- **"I could not finish", a limit, or a refused lookup.** Read the spend
  rows of that minute (`core.model_spend`, operation `ask-dash`): how many
  calls, how many tokens each. Compare with `INPUT_BUDGET`, `MAX_LOOKUPS`
  and `TIME_BUDGET_MS` in `lib/dash/loop.ts`. Then ask why it needed so many
  lookups: usually a tool returned a page of rows when a filtered query would
  have answered (one question about a single company read a page of 50 out of several hundred applications).
- **A wrong or unfounded answer.** Compare the body with what its lookups
  returned (`tool_calls`). If it states something no lookup returned, the
  prompt or the tools let it guess: fix that, not the one answer.
- **A thumbs down or pushback.** Start here. The `rating_note`, the
  question and what they wrote next say what they wanted. Check the data to
  learn what the right answer was, then find why Dash did not give it: a
  lookup it never made, a tool that could not reach the rows, a page of rows
  read as the whole, or words it put on what it found. The weekly reply check
  (`core.ask_reply_checks`, Mondays) reads the subtler ones with a cheap
  model; treat its findings the same way.

Read `lib/dash/loop.ts`, `lib/dash/ask.ts` and `lib/ask/tools.ts` before
changing Dash. Read the Vercel logs before guessing.

## 3. Fix it, and make it stay fixed

For each cause:

1. Fix it in code, with a unit test that fails before the fix
   (`lib/dash/*.test.ts`, `lib/talk/*.test.ts`). A schema fix is a migration,
   applied now through the Supabase connector (CLAUDE.md).
2. **Add an eval case** for the question that failed, so it can never
   silently break again. Check the expectation against the data first: the
   case must pass for a correct answer and fail for the broken one.

   Every thumbs down and every pushback becomes a case once you know the
   right answer: these are the questions the person actually cares about.

   ```sh
   npx tsx scripts/sql.ts --file /tmp/case.sql
   -- insert into core.dash_eval_cases (user_id, question, expect, origin)
   -- values ('d001bb0f-ffe8-4bfb-880f-17dd1a62b685', 'what roles have i applied to at northwind',
   --         '{"cites_any": ["Northwind"], "max_lookups": 6}', 'turn 1a2b3c4d: fell back after three lookups')
   -- returning id
   ```

   `expect` takes `mentions_all`, `mentions_any`, `mentions_none`,
   `cites_any`, `max_lookups`, `max_seconds`, `allow_failed_lookups`. Every
   case is also held to the floor in `grade.ts`: answered, no fallback, no
   limit, no failed lookup, never "Claude". Prefer facts that will not change
   next week, such as a company that exists or a past order, over counts
   that grow.
3. Merge `origin/main`, run `npm run gate`, and push to main only on
   `gate: all clear` (CLAUDE.md). Commit messages follow
   docs/WRITING-GUIDE.md.
4. Wait for the Vercel deployment of that commit to be READY, then re-ask
   the case you wrote: `select core.run_dash_quality('<case id>')`, and read
   the new run. The fix is done when that case passes against the deploy, not
   when the unit test passes.
5. Close the Dev note the run wrote, with the commit, as the notes
   skill does (`.claude/skills/notes/SKILL.md`). A note you cannot finish is
   marked blocked with the exact question, never left open to look tidy.

## 4. When everything is green: the backlog

A clean night is not a day off. Take the first unfinished item below, do one
real step of it through the same gate, and update this list in the same
commit (strike it, or note what is left). Keep the list honest; add to it
when you see a cause of failure that one fix will not remove.

1. **Shrink the prompt.** Every call sends about 72,000 tokens of rules and
   tool definitions (October 2026). Offer the tools a question needs, by
   workspace or by a cheap first pass, rather than all of them. Measure with
   the health's `avgPromptTokens` before and after; the alert is at 85,000
   (`PROMPT_TOKENS_ALERT`) and the aim is under 30,000.
2. **No lookup may hang or fail opaquely.** Give every lookup a time limit
   and one retry for a transient database error (`lib/ask/tools.ts`
   `executeAskTool`), and make every error tell the model what to try
   instead.
3. **Whole answers, not a page.** Questions about all of something ("roles at
   X", "how much on Y") must reach a filtered query or a count, not the first
   50 rows of a list. Find where the tools return a page and the prompt lets
   the model answer from it.
4. **Grounding.** Every factual claim about their data must rest on a row a
   lookup returned. On 22 October a thread reply said an answer "calls
   Decagon's pricing on work done a finance question"; the answer says
   nothing of the kind, and Dash had read only its first 160 characters. Add a check (cheap model or rules) that flags an answer
   naming rows, amounts or dates its lookups did not return, and record it
   in the run's grading.
5. **Cover every workspace.** At least one case per workspace that is on
   (jobs, shopping, todo, goals, learn, vault, news, you), and one for
   recall. Write them from real questions in their chats.
6. **The connector (MCP) is Dash too.** Connected apps (claude.ai, Claude
   Desktop) call the same lookups through `app/api/mcp` and `lib/connector/`;
   the daily health reads `core.connector_calls` and alerts on `error` and
   `partial` outcomes. Audit of 21 October 2026, still open:
   - The tool list a client loads is 109 tools, about 40,000 tokens: the
     catalogue of tables is repeated in list_rows, open_row, query_rows and
     table_info (`lib/ask/tools.ts`). Name it once.
   - Descriptions name tools the connector does not have: `propose_delete`,
     `change_todo`, `close_todo`, `move_roles`, `search_mail`,
     `propose_watch` (`lib/ask/tools.ts`, `lib/dash/todo-writes.ts`,
     `lib/dash/jobs-writes.ts`, `lib/dash/news-writes.ts`). Make each
     description true for the surface it is sent to.
   - The connector cannot add, rename or close a plain todo, move a role to
     another stage, or delete anything (`CONNECTOR_WRITE_TOOLS` in
     `lib/connector/writes.ts` against the Ask registry).
   - `recordConnectorCall` runs after a write and throws if the log insert
     fails, so the app sees an error for a change that was made and may make
     it again (`lib/connector/mcp.ts`). Log first or never fail the call on
     the log.
   - Partial failures still answer as clean: `agenda` drops the workspaces it
     could not read, `recall` drops rows whose link failed while its totals
     still count them, and `open_row` drops a thread it could not read. Say
     what could not be read in the note, as `search` does, so the log and the
     health see it.
   - `recall` over the connector cannot record its embedding spend (token
     transactions are read-only, migration 0134), so it goes unrecorded.
   - No lookup has a time limit; the route allows 300 seconds.
7. **Thread replies are graded like Ask, with two gaps.** Since 22 October
   a reply to an `@dash` comment keeps its lookups on its turn
   (`addThreadTurn` in `lib/thread/store.ts`), so the health sees it fail or
   run out of lookups. Still open: Goals comments are written through
   `writeComment` (`lib/goals/ask.ts`) and keep no lookups; and a thread
   reply has no thumbs, so the person can only say it was bad by replying,
   which the pushback check reads. Give thread replies the same thumbs Ask
   answers have.
8. **Keep it cheap.** The person does not want to pay for testing. Hold the
   monthly run under $1.50 (`cost_micros`), and the month's checks, by hand
   and monthly, under about $3 together (`core.model_spend`, operation
   `check-dash-quality`). When the cases outgrow it, retire the oldest
   passing ones whose cause another case also covers (`active = false`,
   never deleted). Shrinking the prompt (item 1) also makes every case
   cheaper.

## Rules

- Never weaken a case, raise a threshold, or turn a check off to make the
  run pass. When the facts behind a case change (a role closed, a company
  renamed), retire it with `active = false` and say why in `origin`, and
  write its replacement.
- Never skip the gate, push a red main, or retry a timed-out connector call
  (CLAUDE.md).
- Only the owner's rows, in every query.
- In anything the person reads, the assistant is Dash.
- What needs the person (a secret, a choice between behaviours, money) goes
  in one Dev note marked blocked, and in your report. Everything else you
  decide.

## Report

End with a short report, which reaches the person's phone:

- the run's result (passed of cases, alerts) and whether the pipeline ran;
- what you fixed, each in one line with its commit;
- what is still open and why;
- on Mondays, the last seven days: answers, thumbs down, pushback,
  unfinished answers, average prompt tokens and test spend, and whether each
  is getting better.

Four to eight lines. No headings, no padding.

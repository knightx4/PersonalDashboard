---
name: dash-quality
description: Keep Ask Dash answering reliably, efficiently and truthfully. Read the nightly Dash quality run (core.dash_eval_runs) and the last day of real answers, root-cause every failure and alert, fix it in code with a test and a new eval case, ship it through the gate to main, re-run the check against the deploy, and close the note. When all is green, work the next item on the backlog below. Use when the daily Dash quality routine fires, or the user says "check on Dash", "why did Dash fail", "is Dash working", or "work the Dash quality backlog".
---

# Dash quality

You own Ask Dash working well. Not one bug at a time when the person
notices: every day, from evidence, before they notice. The person should
never see "I could not finish this answer", a lookup that "did not work", or
an answer that states things it did not look up.

A day's work is: read what the pipeline found, fix the causes, prove the
fixes against the live Dash, and leave the system a little better than you
found it. Report in a few lines at the end.

## The pipeline you are running

- **Cases**: `core.dash_eval_cases`, real questions with what a good answer
  must show (`expect`, graded by `lib/dash/quality/grade.ts`). Only the
  owner's rows. Not in git, because they are about the person's data.
- **Nightly run** at 07:17 UTC: pg_cron posts to `/api/cron/dash-quality`
  (migration 0277), which asks every active case of the deployed Dash with
  the person's chosen model, read-only and kept out of their chats, grades
  each, and works out the last 24 hours of real answers
  (`lib/dash/quality/health.ts`). The run is a row in `core.dash_eval_runs`.
  Anything failed or alerted writes a Dev note (`feedback_items`, kind bug,
  page `/ask`, body starting "Dash quality check:").
- **On demand**: `npx tsx scripts/sql.ts "select core.run_dash_quality()"`
  starts a run against whatever is deployed now. It takes two to five
  minutes; then read the newest row. Each run costs about $1 of model spend,
  so start at most two by hand in a day.
- **Code**: `lib/dash/quality/` (grade, health, run), `inngest/core/dash-quality.ts`
  (ports), `app/api/cron/dash-quality/route.ts`, `tests/dash-quality-cron.test.ts`.
- **The weekly reply check** (`core.ask_reply_checks`, Mondays) still writes
  its own note of replies the person pushed back on. Treat its findings as
  cases waiting to be written.

All reads and writes go through `npx tsx scripts/sql.ts` and name the
owner's id, `d001bb0f-ffe8-4bfb-880f-17dd1a62b685` (CLAUDE.md). Run `npm ci`
first if `node_modules` is empty.

## 1. Read what the night found

```sh
npx tsx scripts/sql.ts "select id, trigger, deploy, model, started_at, finished_at, cases, passed, cost_micros, note_id, error, health->'alerts' alerts from core.dash_eval_runs where user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685' order by started_at desc limit 3"
npx tsx scripts/sql.ts "select r->>'question' q, r->'failures' f, r->>'stop' stop, r->'lookups' lookups, left(r->>'body', 400) body from core.dash_eval_runs, jsonb_array_elements(results) r where id = '<run id>' and not (r->>'passed')::boolean"
npx tsx scripts/sql.ts "select id, status, left(body, 300) from public.feedback_items where user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685' and page_path = '/ask' and status not in ('done','declined') order by created_at desc limit 10"
```

**No run in the last 26 hours, or a run with no `finished_at`, means the
pipeline itself is broken, and that is the first thing to fix.** Look at
`cron.job_run_details` for `dash-quality-nightly` (the `cron` schema is
closed to `scripts/sql.ts`; read it with the connector's `execute_sql`), and the function's logs
through the Vercel connector (`get_runtime_logs`, project
`prj_wIVNEKdDSflya9STNYz2YfaCSs7R`, team `team_9TjdaoUXYuRJ8mnVbEysl2KL`,
query `dash-quality`, a window of a few minutes around 07:17 UTC). A route
that runs past 300 seconds is cut off: fewer cases, or faster answers.

For each alert from the real day, find the turns it names:

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
  have answered (the Concourse question read 50 of 832 applications).
- **A wrong or unfounded answer.** Compare the body with what its lookups
  returned (`tool_calls`). If it states something no lookup returned, the
  prompt or the tools let it guess: fix that, not the one answer.
- **A thumbs down.** The `rating_note` and the question say what they wanted.
  Check the data to learn what the right answer was.

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

   ```sh
   npx tsx scripts/sql.ts --file /tmp/case.sql
   -- insert into core.dash_eval_cases (user_id, question, expect, origin)
   -- values ('d001bb0f-ffe8-4bfb-880f-17dd1a62b685', 'what roles have i applied to at concourse',
   --         '{"cites_any": ["Concourse"], "max_lookups": 6}', 'turn cbb3f6f3: fell back after three lookups')
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
4. Wait for the Vercel deployment of that commit to be READY, then
   `select core.run_dash_quality()` and read the new run. The fix is done when
   the case passes against the deploy, not when the unit test passes.
5. Close the Dev note the nightly run wrote, with the commit, as the notes
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
   lookup returned. Add a check (cheap model or rules) that flags an answer
   naming rows, amounts or dates its lookups did not return, and record it
   in the run's grading.
5. **Cover every workspace.** At least one case per workspace that is on
   (jobs, shopping, todo, goals, learn, vault, news, you), and one for
   recall. Write them from real questions in their chats.
6. **Keep it cheap.** Hold the nightly run under $1.50 (`cost_micros`).
   When the cases outgrow it, retire the oldest passing ones whose cause
   another case also covers (`active = false`, never deleted).

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
- on Mondays, the last seven runs: pass rate, unfinished answers, average
  prompt tokens and cost per night, and whether each is getting better.

Four to eight lines. No headings, no padding.

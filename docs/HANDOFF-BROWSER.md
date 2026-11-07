# Where hand-off sessions run, and what that means for a browser

Written for plan #3040.1, under #3040 (bots hand off browser tasks). Read from
the code that starts a session, and from the owner's rows on 7 November 2026.

## Where the session runs

A bot that calls `hand_off` keeps a `session` row in `core.dash_handoffs`
(`keepSessionHandoff`, lib/talk/handoffs.ts). The app then starts the session
in `fireSessionHandoff` (lib/talk/handoff-fire.ts), which runs on the Vercel
deployment and calls `fireFeatureRoutine` (lib/feedback/routine.ts). That is
one HTTPS request:

```
POST https://api.anthropic.com/v1/claude_code/routines/<CLAUDE_DASH_BACKUP_ROUTINE_ID>/fire
{ "text": "<the brief from sessionHandoffBrief>" }
```

Anthropic answers with a `claude_code_session_id` (`cse_…`) and a
`claude_code_session_url` on claude.ai/code. The session is a Claude Code
cloud session: a Linux container Anthropic runs, with this repository checked
out and its traffic going out through Anthropic's agent proxy. Every
hand-off in the owner's rows that has a run id (24 request hand-offs and 2
session hand-offs) has a `cse_` id, so none has run anywhere else.

Nothing on that path touches the person's computer. The fire API carries text
alone (the comment above `projectsRoutine` in lib/feedback/routine.ts), the
app never talks to a process on their machine, and no hand-off has ever been
started from one.

## What that means for Claude in Chrome

Claude in Chrome's tools (`mcp__claude-in-chrome__*`) reach the extension
through a Claude process on the same computer as Chrome: Claude Code run
there, or the Claude desktop app. A cloud session has no such process beside
it. A builder session started on 7 November 2026, in the same kind of cloud
session, was offered no Chrome tools, no `enable__mcp__claude-in-chrome` tool
and no `mcp__remote-devices__*` tool.

So a hand-off session today cannot use the person's Chrome, and cannot even
check whether Chrome is open. The Chrome route needs one of these:

- a session started on the person's computer, by a small runner there that
  picks up browser tasks from `core.dash_handoffs` and runs Claude Code with
  Chrome; or
- a cloud session linked to their computer through the Claude desktop app.
  That link offers the desktop app's own browser pane and computer use, which
  are separate from Chrome and its sign-ins, and nothing shows a routine's
  session can be given it.

Which to build is a choice for the person, put to them as a decision under
#3040.

## The headless route works where the session runs

The cloud session's image has Playwright's Chromium under `/opt/pw-browsers`
(`PLAYWRIGHT_BROWSERS_PATH`). The repository has no Playwright package, and
`tests/interaction/browser.ts` already starts that Chromium headless and
drives it over the DevTools protocol for the phone checks. A hand-off can use
the same, with no paid browser service. It has none of the person's sign-ins,
so it covers public pages only.

## What the row records

Migration 0311 (`handoff_browser`) adds three columns to `core.dash_handoffs`,
on session hand-offs only:

- `browser_task`: the bot passed `browser: true` to `hand_off`. The brief then
  carries a `browser task` line after `kind session`.
- `browser`: the browser the session used, `chrome` or `headless`. Null until
  it picks one.
- `browser_reason`: why that one, or why neither could be used, in a sentence
  the bot can pass on.

No passwords and no page contents are kept.

## The wait for the PC or Mac, and a claim that goes quiet

Plan #3040.4. A browser task is not started in the cloud when it is kept.
`fireSessionHandoff` leaves a row with `browser_task` true pending, so the
runner on the PC or the Mac can claim it (`core.claim_browser_task`,
migration 0312) and do it in the person's own Chrome.

Every minute pg_cron calls `/api/cron/browser-handoffs` (migration 0313,
`inngest/core/browser-wait.ts`, rules in `lib/talk/browser-wait.ts`). One pass:

1. Lets go of a claim whose computer has gone quiet.
   `core.release_stale_browser_claims()` sets `claimed_by` and `claimed_at`
   back to null on a pending browser task claimed over 5 minutes ago by a
   computer whose last heartbeat in `core.browser_runners` is over 5 minutes
   old, or which never sent one.
2. Starts the cloud session on every browser task still pending and
   unclaimed 3 minutes after it was kept (`BROWSER_WAIT_MS` in
   lib/talk/handoff-fire.ts). The update that marks it fired also requires
   `claimed_by is null`, so a computer that claims it in the meantime keeps
   it and no cloud session starts.
3. Says in the thread, as the bot that handed it on, that none of the
   person's computers picked it up and that the cloud session can use public
   pages only. If the cloud session will not start, the line says why
   instead.

A task let go in step 1 has already waited past the 3 minutes, so step 2
starts it in the cloud on the same pass. It does not go back to the other
computer first: a computer that died partway through a task may have left
it half done, and the cloud session starting from the request is the
predictable outcome.

This puts one duty on the runner (#3040.6): it keeps calling
`core.browser_runner_heartbeat` while it works a task, not only while idle.
A runner that stops its heartbeat during a long task loses the task to the
cloud 5 minutes later.

Hand-offs that are not browser tasks start at once, as before.

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

## How a session picks (plan #3040.2)

The dash-backup skill's **A browser task** section has the order. A session
with Claude in Chrome's tools, which only a session on the person's own
computer has, checks that the extension answers and uses it. Without them it
reads public pages in the headless Chromium through `scripts/browse.ts`. When
a page needs a sign-in and Chrome is not there, it uses neither and closes
failed with the reason. In each case it first records the route with
`npx tsx scripts/handoff-session.ts browser <id> --route chrome|headless|none
--reason "…"`, and `close --done` refuses a browser task that has not. A
session never buys, sends or submits a form in either browser.

## The runner on the PC and the Mac (plan #3040.5 and #3040.6)

`npm run browser-runner -- pc` (or `mac`), started from a checkout on that
computer with Chrome open and Claude Code signed in, is the route to the
person's Chrome. Every 30 seconds it sends a heartbeat
(`core.browser_runner_heartbeat`) and claims the oldest pending browser task
(`core.claim_browser_task`, migration 0312). The claim function puts the PC
first: the Mac gets a task only when the PC has sent no heartbeat for 2
minutes.

With a task claimed, the runner checks that Claude in Chrome answers, with a
short `claude -p --chrome` run that lists the tabs. If it does not, the
runner clears `claimed_by` and `claimed_at`, writes nothing else, and sends
no heartbeat and claims nothing for 5 minutes, so the other computer or the
cloud session takes the task. If it does, the runner moves the hand-off to
running, so the cloud starts no second session on it, and runs
`claude -p --chrome` on the hand-off's brief with lines telling the session
it is on the person's PC or Mac. That session follows the skill's **A browser
task**: it records route `chrome` with the reason "Ran on your PC in Chrome.",
replies in the thread and closes the hand-off. A hand-off the session leaves
open is closed failed by the runner. The loop is in
lib/talk/browser-runner.ts and the database calls in scripts/browser-runner.ts.

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

How this fits the runner (#3040.6): a claimed task stays pending only
between the claim and the runner's check that Chrome answers. If Chrome
answers, the runner moves it to fired, and neither the release nor the cloud
fire touches a row that is not pending. If Chrome does not answer, the runner
clears the claim itself and stands down for 5 minutes, so the next pass
starts the task in the cloud. The release in step 1 is for the case neither
covers: a runner that claimed a task and then died or lost its connection
before either move.

Hand-offs that are not browser tasks start at once, as before.

## Why no computer picked one up, to 8 November 2026 (plan #3075)

Every browser task up to 8 November 2026 fell back to the cloud: the four of
7 and 8 November (a0a12685, 8c235e97, e344355a, 5d14309f) were never
claimed, and `core.browser_runners` had no row at all, for any account. No
runner had ever sent a heartbeat. The functions and the service-role path
were checked from a session the same day and answer as they should, so the
runner was never started. Chrome open with Claude in Chrome connected is not
enough on its own: something on the computer has to claim the task.

What changed so that is easier to start and easier to see:

- `npm run browser-runner -- pc --install` (or `mac`) checks the setup,
  sends a first heartbeat, then writes a script into the Windows Startup
  folder or a launchd agent into `~/Library/LaunchAgents` and starts it. The
  runner then starts at sign-in and again 30 seconds after it stops.
  `--uninstall` removes it. The text written is in
  lib/talk/browser-runner-install.ts.
- The runner reads `.env.local` and `.env` in the checkout, so the key need
  not be set in the computer's environment, and it stops with what to fix
  when the key is missing, `claude` does not run, or the first heartbeat
  fails.
- Home in Dev has a **Browser runner** chip: "PC up", "PC seen 3 hours ago"
  or "Never run" (lib/talk/browser-runners.ts).
- When a task falls back, the thread's line says why: the runner has never
  run, when it was last seen on each computer, or that it is up and did not
  take the task, which means Claude in Chrome did not answer there. A cloud
  session gets the same sentence from `npx tsx scripts/handoff-session.ts
  runners` and uses it in place of "I couldn't reach your Chrome".

### The music studio's banner and its /api/jobs 500

These are not the browser runner. The studio (knightx4/music-pipeline,
studio-app, served at map-studio-liard.vercel.app) looks for the PC's own
studio server by asking two addresses for `/api/jobs`: the page's own
origin, then `http://127.0.0.1:8765`, which `Map Studio.cmd` serves on the
PC. The first is a function on the studio's Vercel deployment that answers
500 (`FUNCTION_INVOCATION_FAILED`) on every load; the studio catches it and
moves on. The second answers only while Map Studio.cmd is running, and when
neither does the studio shows "The PC's studio is not running". So the
banner and the 500 share a cause only in that both come from that probe: the
banner means Map Studio.cmd is not running, and the 500 is the studio's own
deployment, fixed in the music-pipeline repository (stop probing the page's
origin, or give `/api/jobs` there an answer that does not crash). Neither
lives in this repository. A cloud session cannot reach 127.0.0.1 on the PC
either, so a studio task that needs the PC's tracks needs the runner there.

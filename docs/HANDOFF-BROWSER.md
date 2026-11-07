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

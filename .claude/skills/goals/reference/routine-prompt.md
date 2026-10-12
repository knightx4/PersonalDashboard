# The goals routine

The standing prompt for the one Claude Code routine every goals run fires.
The app writes the `goals.runs` row first, then fires the routine with a turn
naming the job, the account, the run row and what to work. The jobs, and what
starts each:

| Job | Started by |
|---|---|
| `goal` | **Ask Dash** on a goal, a new goal or errand saved from the home, or the night run mapping a goal with no map or with changed fog (`inngest/goals/overnight.ts`) |
| `area` | **Plan this area** on All goals (`app/goals/actions.ts`) |
| `step`, `phase` | **Ask Dash** on a Dash step or a phase, an `@dash` comment that hands over the step, or the night run working ready Dash steps one at a time (`lib/goals/handover-store.ts`) |
| `prepare` | **Ask Dash** on one of the person's own steps with nothing under it, or an `@dash` comment asking for the same |
| `reshape` | the re-shape tick, ten minutes after the last answer to a question on a goal (`inngest/goals/reshape.ts`) |
| `raise` | the person answering a flag (`lib/goals/flags-store.ts`) |
| `daily` | the daily cron each morning while any goal is open (`inngest/goals/daily.ts`) |
| `weekly` | the daily cron, once a week, while a goal asks for weekly help (`inngest/goals/weekly.ts`) |

The skill says what each job does. The prompt and the connectors are stored
on claude.ai, not read from here, so a change to either takes effect only
once it is made on the routine itself.

## Setting it up

1. On claude.ai, create a routine on this repository with the **Supabase**
   and **Gmail** connectors attached. Gmail is what lets a run pre-fill an
   information step with drafts from the person's email; without it the run
   writes the step empty and says so. It needs no schedule of its own: the app's daily cron
   (`vercel.json`, `/api/cron/daily`) fires the morning run through the API,
   with the same id and token as Ask Dash.
2. Paste the prompt below as its instructions.
3. Copy the routine's id (`trig_…`) and create a token for it.
4. In Vercel, on the project's Production environment, set
   `CLAUDE_GOALS_ROUTINE_ID` to the id and `CLAUDE_GOALS_ROUTINE_TOKEN` to the
   token, then redeploy. The token is scoped to this routine; the plan
   routine's token answers 401.

Until both are set, Ask Dash says so and starts nothing, and the scheduled
runs fire nothing.

## The prompt

```
You work the person's life goals in the goals schema of this repository's
Supabase project (asjztutnqxbecruvyrbj), through the Supabase connector, and
read their email through the Gmail connector.

Read .claude/skills/goals/SKILL.md first and follow it. It says how to read a
goal, how to map the whole path for it (phases, Claude steps, information
steps pre-filled from Gmail, provisional steps, questions with lettered
options), what you may change before and after the person approves a goal,
and how every write is labelled with goals.actor and goals.run_id.

The turn after this one names the job (goal, area, step, phase, prepare,
reshape, raise, daily or weekly), what to work, which user_id and which
goals.runs row this run is. If there is no such turn, write a goals.runs row yourself as
the skill says and work every open goal that is new or has fog.

You change rows, not code. Do not commit or push. Close the run row with a
summary before you stop.

Environment (Claude Code on the web):
- Read and write through the claude.ai Supabase connector (tools mcp__Supabase__*, loaded with ToolSearch before the first call). This repository has no .mcp.json on purpose; use only the connector.
- The goals tables are in the goals schema. Do not run npm ci; you do not need the app built.
```

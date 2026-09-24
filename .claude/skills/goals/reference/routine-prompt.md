# The goals routine

The standing prompt for the Claude Code routine that **Work on this** on a
goal's page fires (`app/goals/[goalId]/shaping-actions.ts`), and that the
daily cron fires each morning when a Claude step is ready
(`inngest/goals/daily.ts`). The app appends a turn naming the goal or the
steps, the account and the `goals.runs` row it wrote; the prompt below is what
the routine carries when it starts. The prompt and the connectors are stored
on claude.ai, not read from here, so a change to either takes effect only
once it is made on the routine itself.

## Setting it up

1. On claude.ai, create a routine on this repository with the **Supabase**
   and **Gmail** connectors attached. Gmail is what lets a run pre-fill an
   information step with drafts from the person's email; without it the run
   writes the step empty and says so. It needs no schedule of its own: the app's daily cron
   (`vercel.json`, `/api/cron/daily`) fires the morning run through the API,
   with the same id and token as Work on this.
2. Paste the prompt below as its instructions.
3. Copy the routine's id (`trig_…`) and create a token for it.
4. In Vercel, on the project's Production environment, set
   `CLAUDE_GOALS_ROUTINE_ID` to the id and `CLAUDE_GOALS_ROUTINE_TOKEN` to the
   token, then redeploy. The token is scoped to this routine; the plan
   routine's token answers 401.

Until both are set, Work on this says so and starts nothing.

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

The turn after this one says what to work (one goal, or the morning's Claude
steps), which user_id and which goals.runs row this run is. If there is no such turn, write a goals.runs row yourself as
the skill says and work every open goal that is new or has fog.

You change rows, not code. Do not commit or push. Close the run row with a
summary before you stop.
```

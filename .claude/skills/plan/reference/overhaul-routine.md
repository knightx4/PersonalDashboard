# The overhaul routine

The standing prompt for the Claude Code routine that works one overhaul: a
feature on the plan with `track = 'overhaul'` (docs/SPEC-LAYER-SPEC.md,
Part 4). The **Work this overhaul** button on an overhaul's row fires it
(plan #1514), through `fireFeatureRoutine` in `lib/feedback/routine.ts`, and
records the fire in `plan_runs` with job `overhaul`. The overnight runner
never fires it and never takes an overhaul's steps.

The app appends a turn naming the overhaul by number and title, the
account's `user_id`, and the overhaul's brief as the plan holds it. The
prompt below is what the routine carries when it starts. The prompt and the
connectors are stored on claude.ai, not read from here, so a change to
either takes effect only once it is made on the routine itself.

## Setting it up

1. On claude.ai, create a routine on this repository with the **Supabase**
   connector attached, and the **Vercel** connector, which the design
   session uses to find the branch's preview deployment. It needs no
   schedule of its own.
2. Paste the prompt below as its instructions.
3. Copy the routine's id (`trig_…`) and create a token for it.
4. In Vercel, on the project's Production environment, set
   `CLAUDE_OVERHAUL_ROUTINE_ID` to the id and `CLAUDE_OVERHAUL_ROUTINE_TOKEN`
   to the token, then redeploy. The token is scoped to this routine; another
   routine's token answers 401.

Until both are set, the button says so and starts nothing.

## The prompt

```
You work one overhaul on this repository's build plan, in the Supabase
project asjztutnqxbecruvyrbj, through the Supabase connector. An overhaul is
a feature in plan_items with track = 'overhaul'.

Read .claude/skills/plan/reference/overhaul.md first and follow it. It says
the order an overhaul is built in (the design session on a branch, the
person's acceptance, the three phases), where the Contract and the Design
log are written, how each step is reviewed against the Contract before it
merges, and when a removal step or the overhaul may close. Each step is
built by a subagent following .claude/skills/plan/reference/building.md,
and you merge it as the Building section of .claude/skills/plan/SKILL.md
says, running npm run gate first.

The turn after this one names the overhaul by number, the user_id, and the
overhaul's brief. If there is no such turn, or the row it names is not on
the overhaul track, stop and say so rather than choosing an overhaul.

Work only that overhaul's steps, in phase order, until nothing of it is
ready: what is next waits on the person (their try-it step, a decision, a
proposed step) or on a block. Never accept the design for the person, close
their try-it step, answer your own decision, or close a removal step or the
overhaul while a count is above its target.

Report every step you closed or blocked by number and title, each Design
log line you wrote, each count with its value against its target, and what
the overhaul now waits on.
```

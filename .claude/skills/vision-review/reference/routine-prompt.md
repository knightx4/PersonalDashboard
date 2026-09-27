# The vision review routine

The standing prompt for the Claude Code routine that the weekly vision review
tick fires (plan #1108). A pg_cron job calls `/api/cron/vision-review` on
Sundays at 14:41 UTC (`supabase/migrations/0110_vision_review_weekly.sql`),
and the route fires this routine through the API unless a review was written
or started in the last six days (`inngest/dev/vision-review.ts`). The fire is
recorded in `plan_runs` with job `vision`, and the Dash tab's Status panel
reads that row and the newest `vision_reviews` row for when it last ran.

The app appends a turn naming the account's `user_id`. The prompt below is
what the routine carries when it starts. The prompt and the connectors are
stored on claude.ai, not read from here, so a change to either takes effect
only once it is made on the routine itself.

## Setting it up

1. On claude.ai, create a routine on this repository with the **Supabase**
   connector attached. It needs no schedule of its own: the database's
   weekly job fires it through the API.
2. Paste the prompt below as its instructions.
3. Copy the routine's id (`trig_…`) and create a token for it.
4. In Vercel, on the project's Production environment, set
   `CLAUDE_VISION_ROUTINE_ID` to the id and `CLAUDE_VISION_ROUTINE_TOKEN` to
   the token, then redeploy. The token is scoped to this routine; another
   routine's token answers 401.

Until the id is set, the weekly tick answers "CLAUDE_VISION_ROUTINE_ID is not
set" and starts nothing.

## The prompt

```
You review each workspace's vision in this repository's Supabase project
(asjztutnqxbecruvyrbj), through the Supabase connector.

Read .claude/skills/vision-review/SKILL.md first and follow it. It says which
workspaces to review, what to read for each since its last review, how to
decide between "still holds" and a proposed edit, and the rows to write.

The turn after this one names the user_id to review for. If there is no such
turn, stop and say so rather than guessing the account.

You change rows, not code. Do not commit or push. Never write module_visions:
an edit waits in vision_reviews until the person accepts it.
```

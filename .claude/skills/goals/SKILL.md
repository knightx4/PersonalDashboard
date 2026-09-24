---
name: goals
description: Work the person's life goals in the goals schema — the tree of areas, goals and steps on /goals. Shaping - read a new or vague goal and propose steps under it, with one or two questions for the person. Re-shaping - read the answers to those questions and turn them into steps. After the person approves a goal, add, split and reorder its steps without asking. Morning run - work the ready Claude steps and store what each produced on the step. Use when the goals routine is fired from "Work on this" on a goal or by the morning run, or the user says "shape my goal …", "break down <goal>", "work on my goals".
---

# Working a goal

Goals is the person's own workspace at `/goals`: areas (money, career, the
city), goals under them, and a tree of steps under each goal. The spec is
`docs/GOALS-SPEC.md`; read "The three levels", "Fog and refining a goal" and
"Approval" before your first write.

Most steps are the person's. Your part is the map: turning a goal into the
things that have to happen, and asking the one or two questions whose answers
change what those things are.

## How you read and write

Through the **Supabase** connector (`mcp__Supabase__execute_sql`, loaded with
ToolSearch), project `asjztutnqxbecruvyrbj`. Every table is in the `goals`
schema. Filter every read and write by the `user_id` in your brief.

**Every write declares who and which run, in the same call:**

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
insert into goals.items (...) values (...) returning id;
```

The two settings last only for that one `execute_sql` call, so they go at the
top of every call that writes. The history trigger reads them to record the
change as yours and tie it to the run. A guard on `goals.items` reads the same
setting and refuses the writes described under "What you may change"; a
refusal is the rule working, so read the message and do what it says instead
of looking for another way round.

Never write `closed_at` (a trigger keeps it), `goals.history` (triggers write
it), `approved_at`, `reviewed_at`, or a question's `resolution`.

## The run row

Every run has a `goals.runs` row.

- Fired from **Work on this** or by the **morning run**: the app has written
  the row as `started`, and its id is in your brief. Use it.
- Started any other way: write one first, with `job` `goal` and `item_id` for
  one goal, or `daily` / `weekly` for a scheduled run, and use its id.

  ```sql
  insert into goals.runs (user_id, job, item_id, status)
  values ('<user>', 'goal', '<goal id>', 'started') returning id;
  ```

Close it before you stop, with a short plain summary of what changed: how many
steps you proposed or added, which questions you asked, what you dropped.

```sql
update goals.runs set status = 'done', summary = '…', ended_at = now()
where id = '<run id>' and user_id = '<user>';
-- or, when the run could not do its job
update goals.runs set status = 'failed', error = '<why>', ended_at = now()
where id = '<run id>' and user_id = '<user>';
```

## Reading the goal

```sql
select id, area_id, title, detail, acceptance, fog, status, approved_at, unit, target
from goals.items
where id = '<goal id>' and user_id = '<user>' and level = 'goal' and archived_at is null;

with recursive tree as (
  select i.*, 0 as depth from goals.items i
  where i.parent_id = '<goal id>' and i.archived_at is null
  union all
  select c.*, t.depth + 1 from goals.items c
  join tree t on c.parent_id = t.id
  where c.archived_at is null
)
select id, parent_id, depth, kind, status, title, detail, acceptance, resolution,
       position, due_on, rhythm_count, rhythm_period
from tree order by depth, position;
```

Also worth a look where they exist: the area's other goals (so you do not
propose a duplicate), `goals.readings` for a measured goal, `goals.links` for a
goal tied to Learn or the job search, and the recent `goals.history` rows for
this goal's steps. A step the person dropped or archived tells you what they
did not want. Do not propose it again.

## Shaping a new or vague goal

A goal is **not approved** while `approved_at` is null. Under it:

1. **Ask one or two questions**, only where the answer changes the steps.
   Each is a step with `kind = 'decision'`, `status = 'open'` (a question is
   the one thing that goes in open before approval), the question as the
   title ending in a question mark, and in `detail` the real options lettered
   from A, one per line, then which you would pick and why. "Strength or
   endurance?" with where each leads is a question. "What are your goals?" is
   not one.
2. **Propose the steps you can already see**, with `status = 'proposed'`.
   Three to eight at the top level is the usual shape, with sub-steps where a
   step is more than one sitting. Each has a `kind`:
   - `mine` for what the person does (go, call, apply, lift),
   - `claude` for what you can produce later (a research note, a draft, a list),
   - `rhythm` for a practice, with `rhythm_count` (1 to 100) and
     `rhythm_period` (`day`, `week` or `month`).

   Each has an `acceptance` saying when it is done, and a `position` in tens
   (10, 20, 30) so the person's own steps can go between them.
3. **Leave out what hangs on an unanswered question.** Say what is not known
   in the goal's `fog` instead: one plain sentence or two.
4. **A goal that turns out to be several goals** gets them proposed as goals:
   `level = 'goal'`, the same `area_id`, `status = 'proposed'`. The person
   approves each one on its own page.

Titles follow `.claude/skills/plan/reference/writing.md`: the title says what
will be true when the step is done, in under about eight words. "Pick a gym
within 15 minutes of home", not "Gym research". Write in plain words; the
person reads these on a phone once a day.

## Re-shaping after answers

When questions under the goal have a `resolution`:

- Write the steps each answer made clear. Proposed if the goal is not
  approved, open if it is.
- Drop your own proposals that an answer made pointless (`status = 'dropped'`).
- Update or clear the goal's `fog`.
- Ask a new question only if an answer opened one. Never re-ask one the person
  answered.

## What you may change

**Before the goal is approved:** your proposals are yours to edit, drop or
split. You may add questions, and close `claude` steps the person added. You
may not change the person's own steps, or turn a proposal into a live step.
Approving is the person's move, on the goal's page; it opens everything you
proposed under the goal at once.

**After it is approved:** add steps as `open`, split one into sub-steps, move a
step under another step of the same goal, and reorder by `position`. Do these
without asking.

**Never, approved or not:** add a goal except as a proposal; change a goal's
`acceptance` (its done-when); close, drop or archive a goal; drop or archive a
`mine` or `rhythm` step; answer a question; approve anything. When one of these
seems right, ask it as a question step instead, with the change you would make
as option A.

Nothing is deleted. Archive with `archived_at = now()` where you are allowed
to, and delete only a row you wrote by mistake in this same run.

## The morning run

The daily cron fires the routine each morning when a `claude` step is ready
(`inngest/goals/daily.ts`), with a brief listing those steps and the
`goals.runs` row it wrote with `job` `daily`. Work only the steps it names.
For each one:

1. Read the step, its goal and the steps around it, as in "Reading the goal".
   The title and `acceptance` say what to produce; the goal says what it is
   for.
2. Produce it: a research note, a draft, a list. Write it for the person to
   read on a phone: plain words, the answer first, sources as links where
   you used any. Use web search where the step needs current facts.
3. Store it on the step and close the step in one write. `result` is the text
   itself (up to 100,000 characters). `result_url` is optional, for when it
   also lives at a link. Only a `claude` step takes either.

   ```sql
   set local goals.actor = 'claude';
   set local goals.run_id = '<the run id>';
   update goals.items
   set result = '<what you produced>', result_url = null, status = 'done'
   where id = '<step id>' and user_id = '<user>' and kind = 'claude';
   ```

The home then lists the step under "Waiting on you" until the person presses
**Mark read**. Never write `reviewed_at`: reading it is theirs, and the guard
refuses it.

A step you cannot finish (it needs something only the person has, or the
facts are not findable) stays open with no result. Say why in the run
summary, and where a question would unblock it, add it as a question step
under the same goal. The summary names each step worked and each one left.

## Stopping

This routine writes rows and nothing else: there is no code to change and
nothing to commit. Close the run row, then end with the same summary in your
reply.

Weekly event research is plan #934, not this routine's job yet.

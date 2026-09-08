---
name: plan
description: Work the build plan in plan_items — the tree of features and steps on /dev/plan. Pick the next ready step (or a named one), build it against its acceptance criteria, verify, commit with the step number, and close it with a note. Use when the user says "work the plan", "build the next step", "do plan #12", "what's next on the plan", or a routine is fired from the Plan page.
---

# Working the plan

The plan is the tree of features and steps on `/dev/plan`, held in
`plan_items` and `plan_dependencies`. It is the source of truth for what gets
built next: a person decides on the page, a session builds from it, and the
page shows what happened. The notes queue (`.claude/skills/notes`) is for what
is *wrong*; this is for what is *planned*.

**The rule that matters: the plan must always tell the truth.** A step is never
left in a state that misrepresents reality. If it cannot be finished, it is
marked `blocked` with the specific question — not left `in_progress` to look
busy, and not marked `done` because the session is ending.

## The tool

`scripts/plan.ts` needs `DATABASE_URL` (service role) in the environment.

```
npx tsx scripts/plan.ts next [--claude]        # what could be picked up, most urgent first
npx tsx scripts/plan.ts list [--all]           # the whole tree, per module
npx tsx scripts/plan.ts show <n>               # the brief: context, detail, done-when, waits, steps
npx tsx scripts/plan.ts start <n>              # claim it (in_progress)
npx tsx scripts/plan.ts done <n> --note "…"    # close it; records HEAD commit
npx tsx scripts/plan.ts block <n> --note "…"   # cannot proceed; say what is needed
npx tsx scripts/plan.ts drop <n> --note "…"    # will not do; say why
npx tsx scripts/plan.ts add "title" --parent <n> [--done-when "…"]
npx tsx scripts/plan.ts depends <n> --on <m>   # n cannot start until m is done
```

Steps are named by number — the `#12` on the page. Numbers are never reused.

## Which steps are yours

- A step **assigned to Claude** is yours to pick up on your own. `next --claude`
  lists them in order.
- A step **named by the user** ("do #12", or a routine fired from the page with
  a brief) is yours whoever it is assigned to.
- Anything else, ask before starting. A step nobody has handed over may be one
  the user wants to do themselves, or is still thinking about.

"Ready" means: not started, nothing it waits on is still open, none of its own
sub-steps are still open, and nothing above it is blocked or dropped. A feature
with open sub-steps is worked through its sub-steps; the feature itself is what
you close when they are all done.

## The loop

One step at a time. Do not start the next until the current one is closed.

1. **Read the brief.** `show <n>`. Read the "Done when" section twice; it is
   what the work is checked against. If there is none, write one from the
   detail and the parent's context before starting, and say so in the note.
2. **Look at what it waits on and what it unblocks.** A brief that says "waits
   on #9 (still open)" is not ready, whatever `next` said a minute ago. Stop.
3. **Claim it.** `start <n>`.
4. **Break it down if it is large.** A step sized `l`, or one whose brief
   describes more than one sitting of work, gets sub-steps first
   (`add "…" --parent <n>`), each with its own done-when. Then work those. The
   plan is more useful with the breakdown in it than with the breakdown in
   your head.
5. **Make the change.** The smallest change that meets the done-when. Follow
   the repo's rules (`README.md` "Rules", the module's spec in `docs/`). Do not
   fold unrelated cleanup into a step's commit.
6. **Verify before closing.** All four, every time:
   - `npx tsc --noEmit -p tsconfig.json`
   - `npx eslint app lib components scripts --max-warnings 0`
   - `npx vitest run lib` (two FX tests fail without network — that is
     pre-existing, everything else must pass)
   - `npx next build` when routes, pages, or server actions changed
   Then check the done-when line by line. If a line is not met, it is not
   done.
7. **Commit the step on its own.** One step per commit. End the subject with
   the step: `Add the anonymous share page (plan #14)`.
8. **Close it.** `done <n> --note "what changed, in one sentence"`. The commit
   is recorded from HEAD, so close after committing. The output names any
   steps that became ready as a result — mention them in the report.
9. **Push once per batch**, then report: what was closed, what became ready,
   what is blocked and on what.

A step that turns out to need a decision from the user is `block <n> --note
"the question"`, with the exact question. A step that should not be done is
`drop <n> --note "why"`. Never delete a step; deleting is the user's.

## When the CLI cannot run

`DATABASE_URL` is not set in Claude Code on the web, so `scripts/plan.ts`
exits immediately there. Fall back to the **`Supabase`** connector against
`plan_items` and `plan_dependencies` (both in `public`; project ref
`asjztutnqxbecruvyrbj`), and do not spend the session diagnosing it. The
brief a routine was fired with is the plan as it stood; trust it, and re-read
the row before closing it.

The reading rules are in `lib/plan/tree.ts` and are what the page uses; when
working by hand, apply the same ones:

```sql
-- the open steps, in reading order
select number, parent_id, title, status, priority, size, assignee, acceptance, comment
from plan_items
where user_id = '…' and status not in ('done', 'dropped')
order by module nulls last, position, created_at;

-- what a step waits on
select d.depends_on_id, p.number, p.title, p.status
from plan_dependencies d join plan_items p on p.id = d.depends_on_id
where d.item_id = '…';

-- start
update plan_items set status = 'in_progress' where id = '…';

-- done (after committing, so HEAD is the commit that did it)
update plan_items
set status = 'done', commit_sha = '…',
    comment = coalesce(comment || E'\n\n', '') || 'Done <date>: …'
where id = '…';

-- block: not finished, so no commit
update plan_items
set status = 'blocked',
    comment = coalesce(comment || E'\n\n', '') || 'Blocked <date>: <the question>'
where id = '…';
```

`started_at` and `completed_at` are kept by a trigger from the status; do not
write them. A step is never closed without a note.

## Statuses

| Status | Meaning |
|---|---|
| `not_started` | Decided on, not begun. |
| `in_progress` | Claimed right now. At most one at a time. |
| `blocked` | Needs an answer or something outside the repo. Reason required. |
| `done` | Shipped, verified against its done-when. Carries the commit. |
| `dropped` | Decided against. Reason required. |

Waiting on another step is not a status — it is a row in `plan_dependencies`,
and it clears itself when the other step is done. Do not mark a step
`blocked` for that; add the dependency instead.

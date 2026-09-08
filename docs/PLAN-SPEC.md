# The plan

`/dev/plan` is the source of truth for what gets built next. It holds the
features that were decided on, the steps that get you to each, and the steps
beneath those — to any depth — with each step's status, priority, size, who
is on it, what it waits on, and what "done" means for it. A person works it
on the page; a Claude session works it through `scripts/plan.ts` and
`.claude/skills/plan`; both read and write the same rows, so neither can be
out of date with the other.

It is not an issue tracker. There is one account, one repository and two
builders, and everything Linear or Jira has that exists to coordinate more
people than that is left out. What is kept is the part that changes what gets
picked up next.

## Where it came from

The plan began as `docs/BUILD-ORDER.md` and the per-module specs, and was
seeded from them once (migration 0051, the *Import the build order* button).
The documents remain the record of *why* each step is where it is. They are
not read at runtime and are not kept in sync: the app is the working copy,
and the two are expected to drift. Migration 0052 made the flat list a tree
and gave a step the rest of what is described here.

## The model

Two tables in `public`, both under row level security.

### `plan_items`

| Column | Meaning |
|---|---|
| `number` | The short, stable handle — "#12" — per account. Assigned by a counter on the profile and **never reused**, so a number in a commit message stays meaningful after the step is deleted. |
| `module` | The workspace the step belongs to, or null for the app as a whole. A sub-step always has its parent's module. |
| `parent_id` | The step this is part of, or null at the top of a module's plan. Cascades on delete: removing a feature removes its steps. |
| `title`, `detail` | What it is, and what it involves. |
| `acceptance` | *Done when.* Written before the work, it is what the work is checked against. A step without one is closed on somebody's opinion. |
| `status` | `not_started`, `in_progress`, `blocked`, `done`, `dropped`. |
| `comment` | Your own note on it: why it stalled, what changed. The CLI appends a dated line when it closes or blocks a step. |
| `priority` | 1 next, 2 normal, 3 someday — the same three the notes queue uses. |
| `size` | `s`, `m` or `l`. Coarse on purpose: "one sitting or not", not hours. |
| `assignee` | `me` or `claude`. A step handed to Claude is one a routine may pick up on its own. |
| `commit_sha` | The commit that shipped it. |
| `position` | Order among siblings. Sparse; re-dealt in tens when a step is moved. |
| `started_at`, `completed_at` | Kept by a trigger from the status. Done and dropped both count as finished; a reopened step loses its completion time. |

Two triggers keep it a tree. A parent has to be the same account's own step
— "another account's step" and "no such step" are the same refusal, because
the lookup runs under the caller's policies — and a step cannot be moved
under one of its own descendants.

### `plan_dependencies`

`item_id` cannot start until `depends_on_id` is done. One direction; the
other reading ("this unblocks that") is the same row read backwards. A
trigger refuses a loop, however long the way round, and refuses either end
belonging to another account. Deleting either step deletes the row.

Waiting on another step is a relation rather than a status because it
clears itself: the moment the other step is done, this one is ready, and
nobody has to remember to come back and unblock it. `blocked` is for waiting
on the outside world — an answer, an API key, a decision.

## The reading

`lib/plan/tree.ts` turns the rows into what the page and the CLI show. It is
pure and tested, and it is the only place these rules live.

**Nesting.** Siblings are ordered by position, then age. A step whose parent
is missing is shown at the top of its module rather than lost.

**Waiting.** A step waits on its own unfinished dependencies *and* on those of
every step above it: a feature that waits on another waits with all of its
steps. Done and dropped dependencies are out of the way; a dropped one is
shown plainly rather than freezing the dependent forever.

**Ready.** A step could be picked up now when it is not started, waits on
nothing, has no open sub-steps, and nothing above it is blocked or dropped.
A feature with open sub-steps is worked through them; the feature is what
you close when they are all done — and at that point it is itself ready.

**Roll-up.** A feature's progress is over the leaf steps beneath it, not the
containers in between, and a module's progress is over its leaves, so a
feature with steps is not counted twice. Dropped steps leave the
denominator; in-progress counts as started, not as part done.

**Work order.** Every ready step, most urgent first, and within a priority
in reading order — modules as the switcher lists them, then top to bottom.

**Views.** `?view=` narrows the page to `open` (the default), `ready`,
`blocked` (blocked by hand or waiting on another), `claude` (open steps
handed to Claude) or `all`. A step that does not match stays, dimmed, when
something beneath it does, so a ready sub-step is seen in its place.

## The page

Each module is a section with its progress bar. Each step is a line: the
status picker (one click changes it), the number, the title, and the facts
that matter — *Next* or *Someday*, the size, *Claude*, *Ready*, *Waits on
#n*, and *done/live steps* on a feature. The chevron folds the sub-steps,
closed by default on a finished step. The title opens the detail: what it
involves, done when, your note, what it waits on and unblocks, dates, the
commit, and the actions — edit, add a sub-step, hand to Claude, send to
Claude. The menu on the line adds a sub-step, edits, moves the step up or
down among its siblings, or deletes it with its count of sub-steps in the
confirm.

Editing a step includes moving it: *Part of* lists the module's other steps,
less the step's own subtree. A moved step goes last under its new parent.

## Claude

Three ways in, all landing on the same rows.

**The CLI.** `npx tsx scripts/plan.ts` with `DATABASE_URL` set:

```
next [--claude]     what could be picked up, most urgent first
list [--all]        the tree, per module
show <n>            the brief
add "…" --parent <n> [--done-when "…"] [--size s|m|l] [--claude]
start | done | block | drop | reopen | assign | priority | depends | undepend
```

`done` records the HEAD commit and names the steps that became ready.

**The brief.** `lib/plan/brief.ts` writes a step out for whoever is about
to build it: where it sits, what it involves, done when, what it waits on
(its own and inherited), its sub-steps as a checklist, what it unblocks,
the note. It is what `show` prints and what *Send to Claude* sends.

**Send to Claude.** The button on a step marks it Claude's and fires the
same routine the notes queue uses (`fireFeatureRoutine`, with
`CLAUDE_API_KEY` and optionally `CLAUDE_FEATURE_ROUTINE_ID` on the
deployment), with the brief as the extra turn. The session that wakes up is
told which step it is for and to follow `.claude/skills/plan`.

**The skill.** `.claude/skills/plan/SKILL.md` is the procedure: read the
brief, check what it waits on, claim it, break it down if it is large, build
to the done-when, verify, commit with `(plan #n)` in the subject, close with
a note. A step assigned to Claude is Claude's to pick up; a step named by
the user is Claude's whoever holds it; anything else, ask. The plan must
always tell the truth: a step that cannot be finished is blocked with the
question, never left in progress and never closed to look tidy.

## What is deliberately not here

- **Labels, projects, cycles, estimates in hours.** The module is the
  project; the tree is the grouping; the size is the estimate.
- **Drag and drop.** Move up and move down are two clicks and cannot drop a
  step somewhere by accident. Moving between parents is a select in the
  edit form.
- **Comments as a thread.** One note per step, appended to by the CLI. A
  conversation about a step happens in the session that builds it.
- **Reading the plan from the docs again.** See *Where it came from*.

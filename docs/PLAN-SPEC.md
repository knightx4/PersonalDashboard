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
The seed itself, `lib/plan/seed.ts`, is still read: opening the page brings in
any step in it that has never been offered to this account, recorded in
`plan_seed_imports` (migration 0055). Offered once is the whole rule — delete a
step you decided against and it stays deleted, and nothing already in the plan
is touched. That is only for steps that come from the repository; steps written
here or through `scripts/plan.ts` never go near it.
The documents remain the record of *why* each step is where it is. They are
not read at runtime and are not kept in sync: the app is the working copy,
and the two are expected to drift. Migration 0052 made the flat list a tree
and gave a step the rest of what is described here. Migration 0054 added
`kind`, `fog` and `resolution`, borrowed from the wayfinder planning skill —
see *Decisions and fog*.

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
| `status` | `proposed`, `not_started`, `in_progress`, `blocked`, `done`, `dropped`. A proposed step was written by a session from an idea and is waiting on the person; see *Proposals* below. |
| `kind` | `build` or `decision`. A build step closes on a commit; a decision closes on an answer. See *Decisions and fog* below. |
| `fog` | The *not yet specified* note: one paragraph admitting what cannot yet be seen well enough to write steps for. Allowed on any step, meaningful mostly on a feature. |
| `resolution` | The answer a decision closed with, in the person's words. Null on a build step and on a decision nobody has settled. |
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

## Proposals: from an idea to the plan

An idea on `/dev/ideas` is a sentence. A plan step needs a parent, steps
beneath it, a "done when" and a size, and writing that well takes knowing
the code. So the shaping is Claude's job and the approving is the person's.

1. **Shape into a plan**, a button on each idea, fires the feature routine
   with the idea as the brief and the shaping procedure from
   `.claude/skills/plan` as the job.
2. The session reads the idea and the code and writes a feature with its
   steps into the plan, every one in the **`proposed`** status, and links
   the idea to the feature (`ideas.plan_item_id`). It builds nothing and
   approves nothing. Open questions go in the feature's detail.
3. The person reviews on `/dev/plan`. The proposed view lists what is
   waiting. Three cheap moves are the whole review: drop a step, reorder or
   reprioritise, and **Approve** — the first choice in a proposal's health
   menu, which moves the step and every proposed step beneath it to not
   started in one click. Handing a step to Claude is the fourth move, and
   the one that makes the routine pick it up.
4. From there the building loop applies. The idea's button has become the
   link "in the plan as #n".

A proposed step is never ready, is left out of every progress count, and
is never picked up by `next`. A step beneath a proposed feature is not
ready either, whatever its own status says. Nothing in the skill or the CLI
moves a step out of `proposed` except the person's approve, on the page or
with `scripts/plan.ts approve`.

## Decisions and fog

Two things a proposal could not say until migration 0054, both borrowed from
the wayfinder planning skill. They exist because of what a shaping session
does when it hits the edge of what it knows: it picks an answer and writes
steps as though the question were settled, or it invents a plausible second
half. Both read, afterwards, exactly like a plan somebody made.

**A decision** is a step whose resolution is an answer rather than a commit.
The session that shapes the feature writes the question, the two or three
real options, what each costs and its recommendation; the person settles it
in one box on `/dev/plan`, or with `scripts/plan.ts answer <n> --note "…"`.
It closes as `done` with the answer in `resolution` and **no commit** — a
question is not work, and a commit against one would be a lie the plan told
about itself.

It is a *kind* rather than a status because it moves through exactly the
states a build step moves through — it can be not started, blocked, dropped —
and differs only in what closing it means. As a status it would have to be
crossed with all five of those to say where the question stood.

A decision counts toward its module's progress like any other step: deciding
is real work, and a feature held up on an unanswered question should not read
as being further along than it is.

**Never answered by a session.** `workOrder` withholds a decision from
`--claude` however it is assigned, `scripts/plan.ts start` refuses one and
says where it is answered instead, `add` withholds `--claude` from one, and
the skill says it twice. The guarantee is worth the four locks: a routine
that can answer its own questions has no questions, only guesses with a paper
trail. The cost is real and accepted — a decision nobody answers stalls
everything that depends on it until the person looks at the page.

**Fog** is the other half. Where a decision is a question sharp enough to
phrase, fog is the admission that a question cannot even be phrased yet: one
paragraph on the feature saying what is not known and what would have to be
found out. The test between them is not whether the question can be
*answered* — it is whether it can be *asked*.

Fog is a column rather than a table because it has no life beyond its step:
it graduates into sub-steps and is cleared once they exist. Two things do
that graduating, and until they were built the sentence you just read
described a person doing it by hand: **Re-shape** (below), and a build
session that learns enough while working a step beneath the feature to
specify what the fog admitted it could not. Both write proposed steps and
clear the patch; neither approves anything. It shows in the tree under the step it belongs to
rather than behind the fold, because a plan's own admission that part of it
is missing is no use if you have to open a step to find it. Empty fog
renders nothing.

**Carried forward.** Every answered decision beneath a feature appears in the
brief of every step under it, as *Decided so far*, one line with its answer;
the feature's own done-when appears as *Destination*. Generated from the rows
rather than maintained, so it cannot fall out of date. This is what the
feature is for: a session three nights later builds against what was decided
without being told again, and never asks the same question twice.

**Out of scope** was considered as a sixth status and left out. It is
`drop <n> --note "out of scope: …"`, which reads the same and costs no
column.

## The routines

Two of them, because there are two queues. **Morning notes review** runs on a
schedule and works `feedback_items`; **Plan step builder** has no schedule at
all and works `plan_items`, fired only by a button here or on the ideas page.
They were one routine once, and one is what the buttons had to share.

That sharing had to end for a reason worth writing down: the bugs page's
*Run Feature Routine* sends **no text of its own**, leaning entirely on the
routine's standing prompt. So a button pointed at the wrong routine does not
fail — it quietly works the other queue. Hence a variable per queue, and a
token per queue beside it, because a routine token is scoped to the routine
rather than to the account and the other one's answers `401 Token is not
authorized for this routine`:

| | id | token |
|---|---|---|
| notes | `CLAUDE_NOTES_ROUTINE_ID` | `CLAUDE_NOTES_ROUTINE_TOKEN` |
| plan | `CLAUDE_PLAN_ROUTINE_ID` | `CLAUDE_PLAN_ROUTINE_TOKEN` |

The ids fall back to `CLAUDE_FEATURE_ROUTINE_ID` and then to a built-in
default; the tokens fall back to `CLAUDE_API_KEY`. `lib/feedback/routine.ts`
hands out an id and a token together as one pair, so an id cannot be repointed
without its token following.

The plan routine's standing prompt is the frame; the turn a button appends
says what this firing is for, and wins:

- ***Send to Claude*** on a step — build that one step, then stop.
- ***Send all n beneath*** on a feature — every open step under it becomes
  Claude's, the way approving cascades, and one session works them in plan
  order, each verified, committed and closed before the next is claimed. It
  stops at the first step that needs a decision, blocking it with the question
  rather than skipping to a later one. Push and merge happen once, at the end.
- ***Shape into a plan*** on an idea — write the proposal and nothing else.

The batch button is the one to think twice about. There is no review point
between its steps, so a step that gets something wrong early has the rest
built on top of it before anybody looks. Send a migration on its own; batch
the rest once you have seen what it did.

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
Narrowed to Claude it drops decisions, however they are assigned: a ready
decision is ready for the person, not for a session.

**Views.** `?view=` narrows the page to `open` (the default), `you`, `ready`,
`proposed`, `blocked` (blocked by hand or waiting on another), `claude`
(open steps handed to Claude) or `all`. A step that does not match stays, dimmed, when
something beneath it does, so a ready sub-step is seen in its place.

`open` is everything not done and not dropped — proposals included. It is the
whole of what is outstanding, which is what the word has to mean for the
default view to be worth landing on.

`you` is the part of that which cannot move until the person acts: unanswered
questions, proposals nobody has decided on, and blocked steps. Not their ready
steps — that is work they could do rather than something being asked of them,
and folding it in makes "waiting on you" a list that cannot be cleared.

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

A decision is marked where a build step's checkbox would be, with a `?`. Its
health reads *Unanswered* rather than *Ready* — on a question, "ready" would
read as ready to be built, which is the one thing it is not — and its health
menu offers **Answer** first, where a build step offers *Done*; *Done* is not
offered on one at all. Opening it shows a single box, and an answer already
given sits above that box rather than being loaded into it.

Editing a step includes moving it: *Part of* lists the module's other steps,
less the step's own subtree. A moved step goes last under its new parent. The
editor also holds the *not yet specified* box; emptying it clears the column.

## The changelog

`/dev/changelog` is the fourth page in the workspace and the only one that
looks backwards. The other three say what is going to happen; this says what
already did — for each day, the plan steps closed and the notes fixed, newest
first, each with the commit that shipped it and a link back to the list it
came from.

**Where a line comes from.** The app's own closed rows, and nothing else: a
`plan_items` row marked `done`, or a `feedback_items` row marked `done`. Both
tables already carry `commit_sha` and `completed_at`, so the changelog needs
no table, no migration and no writing habit of its own — it is a second
reading of rows the plan and the notes queue already maintain. That is the
answer recorded on plan step #122, chosen over generating a file from the git
log at build time: a deployment on Vercel knows its own sha and nothing
before it, so reading history at runtime is not available there, and a
generated file goes stale between releases.

**What deliberately does not appear.**

- **Work done off the plan and outside the notes queue.** A refactor, a UI
  sweep, a fix nobody filed: the app never knew about it, so it has no line.
  This is the standing cost of the answer above, and the reason to close a
  step or a note for work worth remembering.
- **Dropped steps and declined notes.** Both closed; neither shipped, and a
  changelog listing them would be claiming otherwise.
- **Anything with no `completed_at`.** The trigger sets that column from the
  status, so a `done` row without one was edited around the app rather than
  closed through it, and there is no day to file it under.

**How it reads.** Days come from the entries rather than off a calendar, so a
day nothing shipped on has no heading. The day is the UTC date of the instant
the row closed, matching the activity feed on the job side rather than the
account's timezone — one grouping rule across the app is worth more than a
heading that is right about the evening. An account with nothing shipped gets
an empty state, not a blank page.

The reading is `lib/changelog/entries.ts`, pure and tested in the shape
`lib/plan/tree.ts` has; the two queries behind it are `lib/changelog/load.ts`,
each filtered by user and status and capped at 200.

**Not filterable by module in v1.** The list is short enough to read straight
through. Whether any of this should ever face the user outside `/dev` — a
"what's new" on the front page — turns on whether lines written for a builder
read as history to somebody who did not build them, which cannot be judged
until the page has been lived with.

## Claude

Three ways in, all landing on the same rows.

**The CLI.** `npx tsx scripts/plan.ts` with `DATABASE_URL` set:

```
next [--claude]     what could be picked up, most urgent first
list [--all]        the tree, per module
show <n>            the brief
ideas               ideas not yet shaped into the plan
add "…" --parent <n> [--done-when "…"] [--size s|m|l] [--claude] [--proposed] [--idea <id>]
                    [--fog "…"] [--kind decision]
approve <n>         a person's move: the step and the proposed steps beneath it
answer <n> --note   a person's move: closes a decision on its answer, no commit
start | done | block | drop | reopen | assign | priority | depends | undepend
```

`done` records the HEAD commit and names the steps that became ready;
`answer` does the same without a commit. `start` refuses a proposal and
refuses a decision. `next` and `list` mark a decision `(?)` rather than with
a checkbox, and print a step's fog beneath it.

**The brief.** `lib/plan/brief.ts` writes a step out for whoever is about
to build it: where it sits, the feature's *destination* and the decisions
already settled beneath it, what it involves, done when, anything *not yet
specified*, what it waits on (its own and inherited), its sub-steps as a
checklist, what it unblocks, the note. A decision leads with its question
instead. It is what `show` prints and what *Send to Claude* sends.

**Send to Claude.** The button on a step marks it Claude's and fires the
same routine the notes queue uses (`fireFeatureRoutine`, with
`CLAUDE_API_KEY` and optionally `CLAUDE_FEATURE_ROUTINE_ID` on the
deployment), with the brief as the extra turn. The session that wakes up is
told which step it is for and to follow `.claude/skills/plan`.

**Re-shape.** The return trip, and the answer to a plan that goes stale the
moment anything is learned. Shaping runs once, before anything is built;
from then on the feature is a fixed drawing of a thing still moving —
answering a decision recorded the answer and changed nothing else. The
button on a feature fires the same routine with a *re-shape* turn instead
of a build one, carrying the feature, its fog, its open steps and every
answer settled beneath it. The session graduates fog that the answers made
specifiable into proposed steps and clears the patch, drops a step an
answer made pointless with the reason, and writes any question an answer
surfaced as a fresh decision.

On request rather than on every answer: several questions are usually
settled in one sitting, and one session that has read all of them proposes
better than three racing over the same feature. It also keeps answering
independent — the answer is recorded by its own action, so a re-shape that
cannot start loses nothing. Everything it writes is `proposed`, and nothing
it proposes is started; the plan adapts continuously and still changes only
on an approve. It refuses a proposal, which has nothing agreed to adapt,
and a leaf step, which has nothing beneath it to re-read.

**The skill.** `.claude/skills/plan/SKILL.md` is the procedure: read the
brief, check what it waits on, claim it, break it down if it is large, build
to the done-when, verify, commit with `(plan #n)` in the subject, close with
a note. It carries the re-shape job too, which
writes proposals and nothing else. A step assigned to Claude is Claude's to
pick up; a step named by the user is Claude's whoever holds it; anything
else, ask. The plan must
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

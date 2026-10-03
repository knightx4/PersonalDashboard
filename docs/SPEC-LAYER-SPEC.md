# Specs as the layer you work at

This spec makes the specs in `docs/` the thing the person edits and approves,
with the plan and the code beneath them kept in line by Dash. Three things
change. Each spec gets rules that the gate checks. A weekly audit compares the
code with the specs and proposes changes, including overhauls. And the person
approves a short change to a spec, not a list of features, while Dash works out
the plan and the code from it.

The plan stays as it is for small features and for the notes queue. This adds
a layer above it.

> **Status:** shaped 3 October 2026 into proposed features #1499 (rules), #1504
> (spec changes), #1510 (overhauls), #1517 (the core design on job roles) and
> #1521 (the weekly audit). The seven
> features of [CORE-AND-DASH-SPEC.md](CORE-AND-DASH-SPEC.md) (#1448, #1452,
> #1456, #1462, #1467, #1472, #1477) are held until this is in place, so that
> spec can be the first overhaul built this way.

## The layers

| Layer | What it says | Who writes it | Who approves it | What checks it |
|---|---|---|---|---|
| Vision | Why a workspace exists | The person | The person | The weekly vision review, against notes and page opens |
| Spec | What the app does, and the rules it keeps | Dash drafts, the person may write | The person | The gate, through each spec's rules, and the weekly audit |
| Plan | How it gets built, in features and steps | Dash | Approved with the spec change it came from | Done-whens |
| Code | The app | Dash | Nobody separately | The gate and tests |

Today the spec row is empty in its last column. [PLAN-SPEC.md](PLAN-SPEC.md)
says the specs "are not read at runtime and are not kept in sync: the app is
the working copy, and the two are expected to drift." That is why a spec
cannot be the layer the person works at: changing one changes nothing, and
nothing says when the code has left it behind.

## What goes wrong without it

Four problems, all seen in the review of 2 October 2026.

Drift is found only when someone reads across the whole app. That review
found eight ways of pointing at a row, five comment thread tables and two
whose-move vocabularies. Each was a reasonable addition when it was made, and
no check would have stopped any of them.

Overhauls are planned like features. A feature adds something, so each of its
steps can go live on its own. An overhaul replaces something, which means a
long middle period with the old and new both in use, a design that every later
step depends on, and removal work at the end that nothing makes anyone do. The
plan has no shape for any of those.

The person approves at the wrong level. Two specs became twelve features on
2 October, on top of three shaped earlier that day. Approving each one is a chore, and it is
not where the person's judgement is needed. Their judgement is needed on
whether the specs describe the app they want.

Notes are fixed page by page. "Links should work in the what you know about
this place section and really anywhere like it" was filed on one page and fixed
on that page, and the same request came back from others. A request that
recurs across pages is a missing rule, and nothing turns it into one.

## Part 1: Rules in every spec

Each spec gains a `## Rules` section. A rule is one sentence about what is
always true of the app, with how it is checked on the line below:

```markdown
## Rules

**R1.** Every comment thread is stored in `core.conversations`.
Checked by: count `thread-tables`, baseline 6, target 1.

**R2.** Every write Dash makes to the person's rows has a `core.dash_actions` row.
Checked by: test `tests/dash-actions-recorded.test.ts`.

**R3.** A Dash reply says what it could not do instead of guessing.
Checked by: audit.
```

A rule is checked in one of three ways:

- **test**: a file in `tests/` or `lib/` that fails when the rule is broken.
- **count**: a named counter in `scripts/spec-counts.ts` that measures how far
  the code is from the rule. Its current value is recorded in
  `scripts/spec-baseline.json`, and the gate fails when a count goes up. This
  is how `scripts/check-ui.ts` already holds the design laws against
  `scripts/ui-baseline.json`. A count with a target is a rule the app does not
  keep yet, and the gap between baseline and target is the work left.
- **audit**: checked by the weekly audit in Part 2 rather than by the gate, for
  rules a machine cannot check, such as whether a page feels like a form.

`tests/spec-rules.test.ts` reads every spec in `lib/specs/registry.ts`, parses
its rules, and fails when a rule names a test file that does not exist or a
counter that `scripts/spec-counts.ts` does not define. So a rule always has a
real check behind it, or says plainly that only the audit reads it.

`/dev/specs` shows each spec's rules with their state: holding, failing, or
for a count, its value against its target.

## Part 2: The weekly audit

A routine, `spec-audit`, runs once a week on Mondays, after the Sunday vision
review. Its skill lives in `.claude/skills/spec-audit`. It works one spec at a
time through a subagent each, so no run has to hold every spec and the whole
codebase at once.

For each spec it reads the spec and the code the spec covers, and writes one
row per finding to `public.spec_findings`:

| Column | Meaning |
|---|---|
| `spec` | The spec's slug in the registry. |
| `section` | The heading the finding is about, or null for the whole spec. |
| `kind` | `holds`, `drifted` (the code does something else), `missing` (the spec describes something not built), `undescribed` (code that no spec covers), or `missing_rule` (from Part 5). |
| `evidence` | File paths, counts, note ids, page opens. |
| `proposal` | `change_code`, `change_spec`, or `none`. |
| `spec_change_id` | The change it led to, when there is one. |

A finding that proposes changing the spec drafts a spec change (Part 3). A
finding that proposes changing the code drafts one too, because the code
change has to be stated against the spec before it can be built: "R1 is
broken in these three places, and here is the overhaul that fixes it" is a
spec change that adds the rule and its count.

Code with no spec at all, such as most of Shopping, gets one `undescribed`
finding per workspace, proposing a spec. Not one finding per file.

The audit stops proposing when five spec changes are already waiting on the
person. It records its findings either way, so nothing is lost, but the person
is never handed a pile.

## Part 3: Changes to specs

A spec change is a row in `public.spec_changes`:

| Column | Meaning |
|---|---|
| `spec` | Which spec. A change may also create a new one. |
| `title` | What will be true afterwards, under about eight words. |
| `why` | Two to five sentences citing the findings, notes or page opens behind it. |
| `diff` | The change to the spec's markdown, as a unified diff. |
| `status` | `proposed`, `approved`, `declined`, `applied`. |
| `made_by` | `me` or `claude`. |
| `plan_item_id` | The feature or overhaul it became, once shaped. |

`/dev/specs` shows a proposed change with its why and its diff, with Approve,
Decline and a comment thread where `@dash` works. A diff over 60 changed lines
is refused when it is written: a change the person cannot read on a phone is
too large to approve in one go, and is split.

Approving a change does three things. A routine commits the diff to `docs/`
and marks the change applied. The change is shaped into work: features through
the plan skill's shaping job, or an overhaul through Part 4. And the features
it becomes are approved with it, since approving the change was the decision.
Whether that last part holds for overhauls is the first decision below.

The person can write a change too, by asking Dash for one in chat, in Ask, or
on a spec's thread. Dash drafts it, and the person approves it like any other.
A spec change never edits a vision; visions stay in the person's words and
change only through the vision review's accepted edits.

## Part 4: Overhauls

A spec change that replaces how something works, rather than adding
something, is shaped as an overhaul. An overhaul is a plan feature with
`track = 'overhaul'`, a new column on `plan_items` whose default is
`feature`. It is built in a different order from a feature, by a different
runner.

1. **Design in code.** One session builds the shared pieces on a branch and
   moves one workspace across completely. For the core-and-Dash overhaul that
   is job roles: a thread, a move label, a Dash write, its record and Undo,
   all on the new core. The person tries it on the branch's preview
   deployment. The files that define the new pieces are listed in the spec
   under a `## Contract` heading.
2. **Steps written from the contract.** Only after the person accepts the
   design are the steps shaped, in three phases: build the new pieces
   alongside the old, move each workspace across one fully switched step at a
   time, then remove the old way. Removal steps are part of the overhaul, and
   their done-when is that the rule's count has reached its target.
3. **One owner.** The overnight runner skips features on the overhaul track.
   An overhaul is worked by its own routine, which keeps a `## Design log` in
   the spec (one dated line per decision made while building), and reviews
   each step's diff against the contract before it merges. Subagents still do
   the building.
4. **A whole-flow test per phase.** Each phase ends with one test in
   `tests/flows/` that runs across the parts, such as: an `@dash` comment on a
   role adds a todo, the change appears in Dash today, and Undo reverses it.
   The next phase waits on it.
5. **Progress as counts.** The plan page shows an overhaul's progress as its
   rules' counts against their targets ("thread tables 6 → 1") rather than as
   steps closed.

While an overhaul is moving workspaces across, its counts already stop new
code from adding to the old way, so other features can carry on beside it. An
overhaul can be paused by blocking it, and the counts keep the half-moved app
from getting worse while it waits.

## Part 5: Notes that point at a missing rule

When the notes routine triages, it compares each new note with the notes of
the last 30 days. When three or more ask for the same thing on different
pages, it files a `missing_rule` finding citing them, and drafts a spec change
adding the rule, with a check where one can be written. The notes are linked
to the change and closed when it is applied, with a reply saying which rule
now covers them. A single note is still fixed on its page, as now.

## Where the person stays in the loop

The person owns the visions, approves or declines spec changes, accepts an
overhaul's design after trying it, and uses what ships. Dash drafts spec
changes, shapes them, builds them, and runs the checks.

Four things a session never does: approve a spec change, edit a vision, close
an overhaul whose counts have not reached their targets, or propose a sixth
spec change while five are waiting.

## First use

1. `## Rules` sections for [CORE-AND-DASH-SPEC.md](CORE-AND-DASH-SPEC.md) and
   [CUT-BACK-SPEC.md](CUT-BACK-SPEC.md), with their counters. For the core
   spec these include thread tables (6 now, target 1), conversational model
   paths (6, target 1), files holding a model id (about 60, target 1), and
   link tables with a column per target (3, target 0).
2. `scripts/spec-counts.ts`, its baseline, and `tests/spec-rules.test.ts`, so
   those rules are enforced from the day they are written.
3. The core-and-Dash overhaul's design session, with job roles moved across.
   Once the person accepts it, the seven held features are rewritten from its
   contract in the three phases above. #1474, the undated "On you" pile,
   was built before the hold and stays.
4. `public.spec_findings`, `public.spec_changes` and their place on
   `/dev/specs`.
5. The weekly audit routine, then the notes routine's missing-rule check.

Steps 1 and 2 come first because they are what stops further drift while
everything else is built. The audit is last because it needs the rules and
the changes table to write into.

## Decisions

**1. Does approving a spec change also approve the overhaul it becomes?**

- A. Yes, with one stop. Approving the change approves the work, except that
  an overhaul's steps wait until the person has tried the design session and
  accepted it. Cost: one more look per overhaul.
- B. Yes, entirely. The overhaul runs from approval to finish. Cost: the
  design is never seen before everything is built on it.
- C. No. Every feature and overhaul a change becomes comes back for its own
  approval, as now. Cost: the approvals this spec exists to reduce.

Recommendation: A. A feature can be judged from its spec change. An overhaul
cannot be judged until its design exists in code.

## Costs

The audit is one Claude Code routine a week, reading about 10,000 lines of
specs and the code they cover. The counters add a few seconds to the gate.

This adds machinery to Dev, which [CUT-BACK-SPEC.md](CUT-BACK-SPEC.md) is
trying to slow. The case for it is that it replaces volume: one approved
change in place of a dozen approved features, and rules that stop drift in
place of reviews that find it afterwards. If the person's approvals per week
do not fall once this is running, it is not working.

## What this does not do

It does not generate code from specs without the plan in between, change how
visions are written or reviewed, or replace the plan and notes queue for small
work. It does not let a session approve anything.

# Working an overhaul

An overhaul is a feature that replaces how something works, rather than
adding something. On the plan it is a feature with `track = 'overhaul'`
(plan #1511). It is built in a different order from a feature, by its own
routine, for the reasons in Part 4 of `docs/SPEC-LAYER-SPEC.md`: the old way
and the new one are both in use for a long time, every later step depends on
one design, and the removal work at the end is easy to leave undone.

This file is the order that routine follows. Its standing prompt is
`overhaul-routine.md`, beside this file. Read `building.md` too: every step
of an overhaul is still built by a subagent following it.

## Whose steps these are

A step under an overhaul (the step itself, or any row above it, has
`track = 'overhaul'`) belongs to the overhaul's run. The overnight runner
never takes one (`runnerOrder` in `lib/plan/overnight-choice.ts`).
`next --claude` still lists them, because the overhaul's run reads that list
for its own steps, so a session working the plan in general skips any row
`isUnderOverhaul` is true for unless it was sent for that overhaul.

## Where things are written

- **The spec.** Every overhaul comes from one spec in `docs/`, named in the
  feature's detail, or in `spec_changes.spec` on the change whose
  `plan_item_id` is the feature. The Contract and the Design log go in that
  spec, nowhere else.
- **`## Contract`**, a heading in the spec, written by the design session.
  It names the counted rules the overhaul brings to their targets and the
  files that define the new pieces, in this form:

  ```markdown
  ## Contract

  Rules: R1, R2, R3, R4.

  - `lib/core/refs.ts`: how one row points at another.
  - `lib/core/move.ts`: whose move a row is on, and its label.
  - `supabase/migrations/0201_core_dash_actions.sql`: the record of each
    write Dash makes, and what undoes it.
  ```

  The `Rules:` line names rules from the spec's own `## Rules` section by
  their number, and only rules checked by a count with a target. It is the
  list the plan page reads for the overhaul's progress, so keep it to that
  form. Each file in the list exists on main once the design is merged, with
  one line on what it is for.
- **`## Design log`**, a heading in the spec after the Contract. One dated
  line per decision made while building, with the step that made it:

  ```markdown
  - 2026-10-14 (#1531): Old thread rows keep their ids as refs, so links in
    old notes still open. Renumbering them would have broken every link.
  ```

  The run writes the line, in the commit of the step that made the decision,
  so the log and the code reach main together. A subagent reports its
  decisions; it does not edit the log.
- **The counts.** Each counted rule's counter is in `scripts/spec-counts.ts`
  and its current value in `scripts/spec-baseline.json`.
  `npm run check:specs` fails when one rises and writes the lower value when
  one falls; `npm run check:specs -- --list` prints what each one counted.

## The order

1. The design session, on a branch, with one workspace moved across.
2. The person tries it and accepts it, or says what is wrong.
3. The design branch is merged, and the phases are written from the
   Contract.
4. Phase 1: build the new pieces alongside the old.
5. Phase 2: move each workspace across, one fully switched step at a time.
6. Phase 3: remove the old way, until every count is at its target.

Decision #1508 settled the one stop in this: an approved spec change
approves the overhaul's work, but nothing of the phases is written or built
until the person has tried the design in one workspace and accepted it. So
an overhaul starts with three rows: the design session, a setup step of the
person's to try it and accept it, and a step to write the phases, which
waits on the setup step. #1517 is the first one. An approved spec change
that replaces how something works is written in this shape by
`scripts/overhaul-opening.ts` (`shaping.md`, step 7).

## 1. The design session

Branch from an up-to-date `origin/main`, named for the overhaul (such as
`overhaul-1517`), or use the session's own branch when the environment
names one. Name the branch in the design step's comment so a later run finds
it. Build the shared pieces the spec describes, and move one workspace onto
them completely: its reads, its writes and its screens use only the new
pieces, and nothing in it still uses the old way. The spec usually names the
workspace; when it does not, take the smallest one the change touches.

- Its schema changes only add tables and columns that main does not read.
  Apply them to the live project in the same sitting, as `CLAUDE.md`
  requires, so main is unaffected while the branch is tried.
- Write the flow test for the moved workspace in `tests/flows/`, running
  the path the spec gives as its example end to end.
- Write `## Contract` and start `## Design log` in the spec, on the branch.
- Push the branch and find its preview deployment (the Vercel connector's
  deployments for the branch, or the deployment check on the pushed commit).
  Put the preview's link in a comment on the person's try-it step
  (`dev_comments`, `plan_item_id`, author `claude`), with what to try.

Do not merge the branch to main. It stays a branch until the person accepts
it. Hand the design step to the try-it step instead: turn the dependency
round, so the try-it step no longer waits on the design step
(`undepend <try-it> --on <design>`) and the design step waits on the try-it
step (`depends <design> --on <try-it>`), and block the design step with
`--on-steps` and the ask `Try the design at <link> and accept it on
#<try-it step>.` When they close the try-it step the block clears itself.

If they comment on the try-it step that something is wrong, rework the same
branch, push it, and reply on that thread saying what changed. The try-it
step stays theirs to close.

## 2. After the design is accepted

**Merge the design branch.** The design step is ready again once the try-it
step is closed. Merge `origin/main` into the branch, run `npm run gate`,
merge it to main with `--no-ff` and push, as in step 4 of the Building
section in `SKILL.md`, then close the design step. Phase 1 does not repeat
this merge.

**Write the phases**, as the write-the-phases step. Read the Contract and
the Design log on main, then write three rows under the overhaul, in this
order, with the steps of each beneath it:

- `Phase 1: Build the new pieces alongside the old`. Every new piece the
  Contract names that the design session did not finish, built so the old
  way keeps working. Nothing switches over in this phase.
- `Phase 2: Move each workspace across`. One step per workspace still on
  the old way. Each step switches its workspace completely, so no workspace
  is ever left half on each.
- `Phase 3: Remove the old way`. One removal step per rule on the
  Contract's `Rules:` line, with the done-when `` count `<counter>` reaches
  its target of <target> ``. A removal too large for one step can be split,
  and the last of its steps carries that done-when.

Each phase ends with a step that writes a test in `tests/flows/` running a
whole flow across that phase's parts, and the next phase row waits on it
(`depends <next phase> --on <flow test step>`). `npm run gate` runs
`tests/flows/` with the rest of `tests/`.

The overhaul is approved, so these rows go in ready to build, each stamped
with the session that added it, as `offline.md` writes it. Two things are
still not approved by it: a step that acts outside the repository is
proposed (`building.md`, **Steps that act outside the repository**), and a
question is a decision row for the person.

## 3. Building a step

Work the overhaul's ready steps in phase order, orchestrated as in the
Building section of `SKILL.md`: each step to its own subagent following
`building.md`, merged by you after the gate, then closed. Add the Contract's
file list and the Design log to the carry-forward each subagent is given,
and ask it to report every decision it made that the Contract does not
settle.

**Review each step against the Contract before it merges.** Read the step's
diff (`git diff origin/main...<the step's commit>`) and check four things:

- New shared behaviour goes through the Contract's files, not a second copy
  of them.
- Nothing adds to the old way. The gate catches a count that rises; the
  review catches a new use the counters do not see.
- A phase 2 step leaves its workspace fully on the new pieces.
- Every decision the subagent reported has a Design log line in the step's
  commit. Write the lines yourself and amend or add a commit against that
  step's number.

A step that fails the review does not merge. Send it back to a subagent
with what failed, or fix it yourself, then review it again.

A decision that would change the Contract itself, such as adding or removing
a shared piece or changing what one of its files is for, changes what the
person accepted. Do not log it and build on it. Write it as a decision under
the overhaul and block the step on it, as `building.md` says under **When
you reach something you should not decide**.

## 4. Removal steps and closing the overhaul

A removal step closes only when its count has reached its target. Before
closing it, run `npm run check:specs` and read the counter's value with
`npm run check:specs -- --list`. When the value is at the target, commit the
lowered `scripts/spec-baseline.json` with the step. When it is still above,
the step stays open: block it with what is left in the ask, such as `3
thread tables remain: learn.discussions, vault.note_threads,
dev_comments.`

The overhaul itself closes only when every phase is done and every rule on
its `Rules:` line is at its target. Never close an overhaul whose counts
have not reached their targets, whatever else is finished.

## Pausing

An overhaul is paused by blocking its feature row. The counts keep the
half-moved app from getting worse while it waits, and other features carry
on beside it, since none of them can raise a count.

## What the run never does

- Accept the design for the person, or close their try-it step.
- Merge the design branch before they have accepted it.
- Answer its own decision, or approve anything.
- Close a removal step, or the overhaul, above target.
- Work steps outside the overhaul it was sent for.

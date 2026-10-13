---
name: plan
description: Work the build plan in plan_items — the tree of features and steps on /dev/plan. Three jobs. Building: pick the next ready step (or a named one), build it against its acceptance criteria, verify, commit with the step's outline, close it with a note. Shaping: turn an idea from the ideas page into a proposed feature with steps, done-whens and sizes, for the person to approve — never built, never approved by a session. Re-shaping: re-read a feature against the questions answered beneath it and the code, writing the work an answer made specifiable as steps (ready under an approved feature, proposed only when they act outside the repository), dropping what an answer made pointless, and writing any new question as a decision. Use when the user says "work the plan", "build the next step", "do plan #1073.4", "shape idea …", "re-shape feature #95", "what's next on the plan", or a routine is fired from the Plan or Ideas page.
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
npx tsx scripts/plan.ts show <n>               # the brief: destination, decisions, done-when, waits
npx tsx scripts/plan.ts start <n>              # claim it (in_progress); refuses a decision
npx tsx scripts/plan.ts done <n> --note "…"    # close it; records HEAD commit
npx tsx scripts/plan.ts answer <n> --note "…"  # the person's move. Never yours.
npx tsx scripts/plan.ts block <n> --ask "…" [--on-steps] [--note "…"]
              # the ask names what the person does; "nothing needed from you" is refused.
              # A step that waits on data, time or a run gets a check-back --from <n>, which holds it.
                                               # cannot proceed; the ask is the one sentence
                                               # saying what it needs, rewritten each time.
                                               # --on-steps: it clears itself when the steps it
                                               # names close; without it, it waits for you
npx tsx scripts/plan.ts needs "<what to set>" --for <n> [--detail "…"]
                                               # something only the person can supply — a key,
                                               # an account. Writes a setup step of theirs under
                                               # the same feature and makes <n> wait on it
npx tsx scripts/plan.ts drop <n> --note "…"    # will not do; say why
npx tsx scripts/plan.ts stopped <n> --reason "…" [--piece "…" --piece "…"]
                                               # ending without closing or blocking <n>:
                                               # one line on why, onto the run. Too big?
                                               # name the pieces it would split into
npx tsx scripts/plan.ts add "title" --parent <n> [--done-when "…"]
                                               [--proposed] [--from <n>]
                                               # ready under an approved feature, a
                                               # proposal under a proposed one.
                                               # --proposed: a new feature, or a step
                                               # that acts outside the repository.
                                               # --from: whose answer made this
npx tsx scripts/plan.ts add "the question?" --parent <n> --kind decision --detail "…"
npx tsx scripts/plan.ts depends <n> --on <m>   # n cannot start until m is done
npx tsx scripts/plan.ts activity <n> --kind thought|action|question|error --body "…" [--option "…"]
                                               # a line on your run (see building.md, run lines)
npx tsx scripts/plan.ts idea "…" [--module <id>] [--from <n>]
                                               # file a follow-on on /dev/ideas; it lands
                                               # marked as your suggestion, under the
                                               # user's own ideas. --from names the step
                                               # you were on when you thought of it. One
                                               # close to an idea already filed is refused
                                               # and names what it matched. Two an hour
                                               # is the most a session can file.
npx tsx scripts/plan.ts idea --file <path.md>  # one idea per "## " heading
npx tsx scripts/plan.ts raise "…" --ask "…" --consequence "<action>: <what>"
                                [--detail "…"] [--module <id>] [--from <n>]
                                               # ask the person something. Never answered by you.
npx tsx scripts/plan.ts raises                 # open raises, and answers no session has replied to
                                               # a closed one is finished with and is not listed
```

### Naming a step

Every `<n>` and `<m>` above is a step's outline, the `1073.4` its row on the
page heads itself with: the fourth step under feature #1073. A top-level
feature's outline is its number. `plan.ts` takes `1073.4` or `#1073.4`, and
prints every step that way.

Name a step by its outline in everything you write: replies and reports,
notes, comments, asks, details, raise text, commit and merge subjects, and the
prompts you give subagents. Write `#1073.4`, with no number beside it. Each
step also has a number (#1084), which is its identity in the database and
never changes, but the person reads the outline. Sessions that wrote "#1081"
for the step the page showed as "1073.1" left them translating one into the
other. Text written before this rule still names steps by number; `plan.ts`
shows it with the outline, and you leave it as it is. Querying the database
directly, join `plan_item_outlines` on `id` to get the outline
(`reference/offline.md`).

If `DATABASE_URL` is missing, read `reference/offline.md` rather than guessing.

**Writing by hand, record each write** to `plan_items` or `ideas` with
`core.record_dash_action`, so Home lists it under what Dash did today with an
Undo: a step or decision added, a step closed, blocked or dropped, an idea
filed or linked. A claim (`in_progress`) is not recorded; the close
that follows it is. `reference/offline.md` shows the calls. The CLI's own
writes are not recorded yet.

## Which steps are yours

- A **proposed** step is nobody's to build. It is a proposal waiting on the
  person. `next` never lists one, `start` refuses one, and nothing in this
  skill moves one out of `proposed` — that is the person's move, on the page.

  **Auto approve.** When the person has turned on auto approve (the switch on
  the Plan row on Home, `plan_overnight_runs.auto_approve`), a trigger writes
  every proposed row as `not_started`. A row you insert as proposed then comes
  back approved and ready. That is the person's standing yes, not a session
  approving: write proposals exactly as you would otherwise.

  **Approval is per feature.** The person approves a feature once, and that
  approves every step beneath it. A step a session adds under an approved
  feature later, while building or re-shaping, goes in ready to build and
  stamped with the session that added it; `/dev/plan` marks it and offers a
  one-press drop, so the person can still turn it down. Three things are
  still proposals: a new feature (shaping, or new work a re-shape finds
  under a finished feature), anything beneath a feature still proposed, and
  a step that acts outside the repository, as **Steps that act outside the
  repository** in `reference/building.md` defines.
- A step **assigned to Claude** is yours to pick up on your own. `next --claude`
  lists them in order.
- A step **named by the user** ("do #1073.4", or a routine fired from the page with
  a brief) is yours whoever it is assigned to.
- A **decision** is never yours, however it is assigned and whoever named it.
  It is a question put to the person, and it closes on their answer. `next
  --claude` does not list one and `start` refuses one. **Never answer your own
  decision** — not by running `answer`, not by writing the resolution into the
  row, and not by building as though it had been settled. A routine that can
  answer its own questions has no questions, only guesses with a paper trail.
  The other half of that rule is to write few of them. A choice you would
  recommend and the person would very likely accept is settled by you and
  noted, not asked; the bar is in `reference/building.md` under **When you
  reach something you should not decide**.
- A **setup step** is never yours either. It is something only the person can
  supply — a key, an account, a value set somewhere a session cannot reach —
  and it closes when they say they have done it, on the page or in the Dash
  tab. `next --claude` does not list one and `start` refuses one. Writing one
  is `needs "…" --for <the step that stopped>`, per `reference/building.md`.
- A **dismissed** row is nobody's. The person has put it aside as not right
  now, and it is hidden from the page, from `next`, from `list` and from every
  brief. You will not normally see one; if you do, leave it exactly as it is.
  Dismissing something and bringing it back are both their moves.
- A step **under an overhaul** (a feature with `track = 'overhaul'`, or any
  row beneath one) belongs to that overhaul's run, which builds it in its own
  order. `next --claude` still lists such steps, so skip them unless you were
  sent for that overhaul; `reference/overhaul.md` is what that run follows.
- Anything else, ask before starting. A step nobody has handed over may be one
  the user wants to do themselves, or is still thinking about.

"Ready" means: not started, nothing it waits on is still open, none of its own
sub-steps are still open, and nothing above it is blocked or dropped. A feature
with open sub-steps is worked through its sub-steps; the feature itself is what
you close when they are all done.

## Building

**One step, on its own** — "do #1073.4", or one step named in a brief. Read
`reference/building.md` and follow it yourself, then put the commit on main as
in step 4 below. A subagent for a single step is pure overhead, except on a
Sonnet session for a step sized `m` or `l` (step 3 below).

**A feature, or more than one step** — you are the orchestrator, not the
builder. Send each step to its own subagent and keep your own context for the
batch. The steps of one feature go to main together, as one merge, once the
feature is finished (step 4).

This is the difference between a batch that finishes and one that stops
halfway. A session that builds nine steps itself carries everything it read for
step 1 through every turn of step 9, and runs out of room around step 3. A
session that sends each step out keeps a paragraph per step instead of forty
thousand tokens, and gets to the end.

1. **Read the raises first.** `raises`, before claiming anything. An open raise
   is the person still waiting to be asked; an answered one carries a reply
   written while nothing was awake, and that answer is what to build against
   from then on. When `raises` ends by saying check-backs are due, run
   `check-backs` and do each one before the batch: it is a look an earlier
   session asked to take at a set time, and closing it is `checked <id> --note
   "what it found"`. To leave one yourself, for something whose result you
   cannot see yet (a scheduled run, a queue draining, a deploy), use
   `check-back "<what to look at>" --after 2h --detail "what to check and what
   to do about each answer"` rather than a routine on the account: it shows on
   the Dash tab, any session can finish it, and the tick wakes one an hour past
   due if none has.

   A step whose history ends in an `Answered …` or `Accepted …` line is acted
   on in this batch. An answer that asks for no change ("It's fine", "yes",
   "ok") is an accept: merge and close. An answer that picks no direction
   takes the option the ask recommended. A new question goes out only when no
   direction can be chosen, and never the same one twice
   (`reference/building.md`, "An answer always moves the step").
2. **Work out the order.** `show <the feature>` gives the tree, the done-whens
   and what waits on what. List the steps you are going to build, in dependency
   order. Steps that wait on nothing come first. A step that waits only on
   steps in this batch is in it, and goes out once those are built on the
   feature branch; a step that waits on anything else still open is not.
3. **Send the ready steps to subagents, up to three at once.** Every step
   that is ready now and does not wait on another step in the batch goes out
   together, each to its own subagent with `isolation: "worktree"`, so each
   builds in its own copy of the repository. When one reports, merge it into
   the feature branch (step 4) and send whatever that made ready, keeping up
   to three going. One
   step at a time left a twelve-step feature taking most of a day while steps
   that waited on nothing sat in the queue.

   Hold a step back from the round when it changes the same screen as
   another step going out, judged from the two details: two builders editing
   one page conflict at the merge and the second rebuilds. Send it when the
   first has merged.

   The prompt is short:

   > Build plan step #<outline>. Read `.claude/skills/plan/reference/building.md` and
   > follow it exactly. You are in a worktree: give it a hard-linked copy of
   > node_modules first (`cp -al <the main checkout>/node_modules .`) and use
   > `PREVIEW_PORT=<3400 + 1, 2 or 3>` for the preview.
   >
   > What earlier steps in this batch worked out: <the carry-forward, below>

   **Pick the builder's model by the step's size.** A step sized `s` goes to
   a subagent with `model: "sonnet"`; `m`, `l` and a step with no size go to
   `model: "opus"`. Name the model every time, because a subagent without one
   takes this session's, and this session may be running on Sonnet. The
   `ui-critic` agent names its own model and is not changed by this.

   **Do not read the step's source files yourself, and do not make the edit.**
   Every file you open is a file you carry for the rest of the batch. Reading
   "just to check" is how the batch runs out of room. The same holds for a
   single step named on its own when this session is on Sonnet and the step
   is sized `m` or `l`: send it to an Opus subagent rather than building it
   here.
4. **Build the feature on its own branch, and put it on main once.** Start
   the batch on a branch named `plan/<feature number>`, cut from `origin/main`,
   or continue it if an earlier session pushed one: its steps marked built are
   already on it. Each step merges into that branch as its subagent reports,
   and the whole feature goes to main in one merge at the end.

   A feature merged one step at a time left the live app half-changed between
   steps, with some screens moved and others not, and ran the three-minute
   gate once a step. A step that only makes sense beside its siblings now
   reaches main beside them, and the gate runs once a feature.

   **As each step reports:**

   - Merge the subagent's worktree branch (its result names it) into the
     feature branch.
   - Run the fast checks on what it changed: `npx tsc --noEmit -p .`,
     `npm run lint`, and `npx vitest run` on the test files beside the files
     it touched. A step that breaks these goes back to its builder before the
     next one merges on top of it.
   - Run `npm run ui-guard -- <outline> --commit <the branch's head>` for a step
     that changed a screen, and send a step it refuses back to the critic.
   - `built <n> --note "…"`, with the note the subagent wrote. The step stays
     in progress and records the commit and the branch; `done` would refuse it,
     because the commit is not on main yet.
   - `git push -u origin plan/<feature number>`. Every step pushed is a step
     that outlives this session, which is what decision #674 asked of the
     arrangement this one replaces.

   **When the feature's steps are built:**

   - `git fetch origin`, with no refs named. Naming them aborts the whole fetch
     when one of them is missing, which is the normal state of a branch nobody
     has pushed yet, and leaves `origin/main` stale.
   - Merge `origin/main` into the feature branch and resolve anything that
     conflicts.
   - `npm run gate`. It runs what CI runs on main: the test database,
     migrations, typecheck, lint, contrast, UI laws, the whole test suite
     including tests/, and the build, in three lanes side by side, and names
     every step that failed. Anything that fails belongs to whichever step
     broke it: fix it with a commit against that step's outline. That includes
     a failure another session merged, because main is what you are about to
     push.
   - Merge the feature branch into `main` with `--no-ff`, subject `Merge plan
     feature #<outline>: <title>`, list the steps it carries in the body, and
     push.
   - `land <feature>`. It closes every step marked built under the feature,
     each against its own commit and with the same checks `done` makes, and
     names any it could not close and why.

   A step sent on its own ("do #1073.4") is not a batch: it merges to main by
   itself, after the gate, with subject `Merge plan step #<outline>: <title>`,
   and closes with `done <n> --note "…"`.

   **When the batch stops before the feature is finished** (a block, a stop,
   or running short): the built steps stay on the pushed feature branch, in
   progress, with their Built lines. Land what is built only if the app works
   with the rest of the feature missing, and say in the report which you did.
   Otherwise leave the branch for the next session, which continues it. The
   rule against leaving a step in progress does not apply to a built step: its
   Built line says where it is.

   **When the merge to main will not go through** — a conflict you cannot
   resolve from what you have read, or a check you cannot get passing — the
   branch is already pushed. Block the step that broke it, `block <n> --ask
   "…" --note "…"`, with the branch named in the note. The ask never names it:
   the person cannot open branches, and `block` refuses an ask that names one.
   Stop the batch there. Decisions #685 and #695 are why.

5. **Keep the carry-forward.** Each subagent reports what the next step needs
   to know. Append it to a running list and pass it into the next prompt. That
   list is the whole memory of the batch, and it is the reason the steps do not
   re-derive each other's findings. Keep it to what is load-bearing; drop a
   line once the steps it was for are closed.
6. **Stop when the plan says stop.** A subagent that reports a block has
   written a decision and blocked its step. Do not build around it and do not
   send a later step that depends on it. Other steps in the batch that do not
   depend on it are still yours to send.
7. **Write Dash's update on each feature the batch worked**, once its steps
   are closed or blocked and before the report (plan #1666):

   ```
   npx tsx scripts/plan.ts update <the feature> --health on_track|at_risk|blocked \
     --body "<two or three sentences on what moved>"
   ```

   The feature's page shows the latest one at the top of its Overview, with
   the health and a line saying how many of its steps are done now and how
   many were done at the update before; the command works out those counts
   from the plan. `on_track` when the feature is moving and nothing open
   threatens it, `at_risk` when something might stop it landing as written (a
   critic stop, a failing merge, a step that keeps growing), `blocked` when it
   cannot move until the person answers or sets something up. The body is
   for the person: what closed, what is next, and what is waiting on them,
   by outline and title, in the writing guide's terms. One update per feature
   per batch, not one per step.
8. **Report when the batch ends**: every step closed **by outline and title**,
   what became ready, what is blocked and on what, and anything raised on
   `/dev/inbox`, by title. A report that says "closed four steps" makes the
   person go and look. Say whether the feature reached main. A closed step is
   on main already; a built step, or one blocked on a failed merge, is on the
   feature branch its history names, which the report names too.

If the batch ends before the steps do — something blocked, or you are running
short — say exactly which steps are left and that they are still handed over.
Do not close what was not built, and do not leave a step `in_progress` behind
you unless it is marked built on the pushed feature branch.

## The other jobs

Each is one file. Read the one you were sent for; do not read the others.

| | |
|---|---|
| `reference/building.md` | Building one step, start to close. What a subagent reads. |
| `reference/shaping.md` | Turning an idea into a proposed feature, or an approved spec change into approved work. |
| `reference/reshaping.md` | Re-reading a feature against the answers beneath it. |
| `reference/unsticking.md` | Finding out why a feature stalled, and fixing it or writing what it waits on. |
| `reference/overhaul.md` | Working an overhaul: the design session, the three phases, the review against the Contract. |
| `reference/overhaul-routine.md` | The standing prompt for the routine that works an overhaul, and how to set it up. |
| `reference/comments.md` | Answering a comment that tags `@dash`. |
| `reference/writing.md` | How to write a title and a detail. Read before writing any row. |
| `reference/raising.md` | The four places something a session has to say can go. |
| `reference/dismissed.md` | What the person has put aside, and why you never bring it back. |
| `reference/offline.md` | The SQL to use when `DATABASE_URL` is missing. |

A shaping run, a re-shape and a re-shape after a vision edit each have a row
in `plan_runs` (job `shape`, `reshape` or `vision_reshape`) that nothing else
marks finished. As the last write of the run, mark yours, under its own job
name: a row marked under the wrong one leaves yours `started`, and it is
written back as failed hours later however well the run went.

```sql
update plan_runs set status = 'finished', error = null
where id = (select id from plan_runs
            where job = '<shape, reshape or vision_reshape>' and status = 'started'
            order by created_at desc limit 1);
```

For a re-shape, add `and plan_item_id = '<the feature's id>'` inside the
select. A re-shape after a vision edit is about no feature, so it adds
nothing. A build run needs nothing: closing or blocking its step ends it.

## Statuses

| Status | Meaning |
|---|---|
| `proposed` | Waiting on the person's approve. Never built. A new feature and the steps shaped under it, or a step that acts outside the repository. |
| `not_started` | Decided on, not begun. |
| `in_progress` | Claimed right now. Up to three at once under one feature run, one per builder. |
| `blocked` | Needs an answer or something outside the repo. Reason required. |
| `done` | Shipped, verified against its done-when. Carries the commit. |
| `dropped` | Decided against. Reason required. |

Waiting on another step is not a status — it is a row in `plan_dependencies`,
and it clears itself when the other step is done. Do not mark a step
`blocked` for that; add the dependency instead.

"Out of scope" is not a status either. It is `drop <n> --note "out of scope:
…"`, which reads the same and needs no sixth column.

## Kind and dismissal

Beside the status, two columns say what a step is rather than where it stands.

| | Meaning |
|---|---|
| `kind` | `build`, `decision` or `setup`. A build step closes on a commit; a decision closes on the person's answer, recorded in `resolution`; a setup step closes when the person says they have done the thing outside the repo, and carries no commit. It is a kind and not a status because all three move through the same states — not started, blocked, dropped — and differ only in what closing them means. |
| `dismissed_at` | Put aside by the person as not right now. Hidden everywhere but the Dismissed view. Never written by a session. See `reference/dismissed.md`. |

Every answered decision beneath a feature is carried into the brief of every
step under it, under **Decided so far**. That is what it is for: ask once,
build against the answer forever after.

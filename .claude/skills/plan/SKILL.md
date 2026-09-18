---
name: plan
description: Work the build plan in plan_items — the tree of features and steps on /dev/plan. Three jobs. Building: pick the next ready step (or a named one), build it against its acceptance criteria, verify, commit with the step number, close it with a note. Shaping: turn an idea from the ideas page into a proposed feature with steps, done-whens and sizes, for the person to approve — never built, never approved by a session. Re-shaping: re-read a feature against the questions answered beneath it, graduating fog into proposed steps, dropping what an answer made pointless, and writing any new question as a decision. Use when the user says "work the plan", "build the next step", "do plan #12", "shape idea …", "re-shape feature #95", "what's next on the plan", or a routine is fired from the Plan or Ideas page.
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
                                               # cannot proceed; the ask is the one sentence
                                               # saying what it needs, rewritten each time.
                                               # --on-steps: it clears itself when the steps it
                                               # names close; without it, it waits for you
npx tsx scripts/plan.ts needs "<what to set>" --for <n> [--detail "…"]
                                               # something only the person can supply — a key,
                                               # an account. Writes a setup step of theirs under
                                               # the same feature and makes <n> wait on it
npx tsx scripts/plan.ts drop <n> --note "…"    # will not do; say why
npx tsx scripts/plan.ts add "title" --parent <n> [--done-when "…"] [--fog "…"]
                                               [--from <n>]  # stamp: whose answer made this
npx tsx scripts/plan.ts add "the question?" --parent <n> --kind decision --detail "…"
npx tsx scripts/plan.ts depends <n> --on <m>   # n cannot start until m is done
npx tsx scripts/plan.ts fog <n> --note "…"    # what cannot be seen yet about
                                               # finishing this feature, one patch;
                                               # --clear once it can be seen
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

Steps are named by number — the `#12` on the page. Numbers are never reused.

If `DATABASE_URL` is missing, read `reference/offline.md` rather than guessing.

## Which steps are yours

- A **proposed** step is nobody's to build. It is a proposal waiting on the
  person. `next` never lists one, `start` refuses one, and nothing in this
  skill moves one out of `proposed` — that is the person's move, on the page.
- A step **assigned to Claude** is yours to pick up on your own. `next --claude`
  lists them in order.
- A step **named by the user** ("do #12", or a routine fired from the page with
  a brief) is yours whoever it is assigned to.
- A **decision** is never yours, however it is assigned and whoever named it.
  It is a question put to the person, and it closes on their answer. `next
  --claude` does not list one and `start` refuses one. **Never answer your own
  decision** — not by running `answer`, not by writing the resolution into the
  row, and not by building as though it had been settled. A routine that can
  answer its own questions has no questions, only guesses with a paper trail.
- A **setup step** is never yours either. It is something only the person can
  supply — a key, an account, a value set somewhere a session cannot reach —
  and it closes when they say they have done it, on the page or in the Dash
  tab. `next --claude` does not list one and `start` refuses one. Writing one
  is `needs "…" --for <the step that stopped>`, per `reference/building.md`.
- A **dismissed** row is nobody's. The person has put it aside as not right
  now, and it is hidden from the page, from `next`, from `list` and from every
  brief. You will not normally see one; if you do, leave it exactly as it is.
  Dismissing something and bringing it back are both their moves.
- Anything else, ask before starting. A step nobody has handed over may be one
  the user wants to do themselves, or is still thinking about.

"Ready" means: not started, nothing it waits on is still open, none of its own
sub-steps are still open, and nothing above it is blocked or dropped. A feature
with open sub-steps is worked through its sub-steps; the feature itself is what
you close when they are all done.

## Building

**One step, on its own** — "do #12", or one step named in a brief. Read
`reference/building.md` and follow it yourself. A subagent for a single step is
pure overhead.

**A feature, or more than one step** — you are the orchestrator, not the
builder. Send each step to its own subagent and keep your own context for the
batch.

This is the difference between a batch that finishes and one that stops
halfway. A session that builds nine steps itself carries everything it read for
step 1 through every turn of step 9, and runs out of room around step 3. A
session that sends each step out keeps a paragraph per step instead of forty
thousand tokens, and gets to the end.

1. **Read the raises first.** `raises`, before claiming anything. An open raise
   is the person still waiting to be asked; an answered one carries a reply
   written while nothing was awake, and that answer is what to build against
   from then on.
2. **Work out the order.** `show <the feature>` gives the tree, the done-whens
   and what waits on what. List the steps you are going to build, in dependency
   order. Steps that wait on nothing come first; a step whose dependency is
   still open is not in this batch.
3. **Send each step to a subagent, one at a time.** The prompt is short:

   > Build plan step #N. Read `.claude/skills/plan/reference/building.md` and
   > follow it exactly. Do not push.
   >
   > What earlier steps in this batch worked out: <the carry-forward, below>

   **Do not read the step's source files yourself, and do not make the edit.**
   Every file you open is a file you carry for the rest of the batch. Reading
   "just to check" is how the batch runs out of room.
4. **Keep the carry-forward.** Each subagent reports what the next step needs
   to know. Append it to a running list and pass it into the next prompt. That
   list is the whole memory of the batch, and it is the reason the steps do not
   re-derive each other's findings. Keep it to what is load-bearing; drop a
   line once the steps it was for are closed.
5. **Stop when the plan says stop.** A subagent that reports a block has
   written a decision and blocked its step. Do not build around it and do not
   send a later step that depends on it. Other steps in the batch that do not
   depend on it are still yours to send.
6. **Run the gate once, at the end.** After the last step closes, before
   pushing:
   - `npx eslint app lib components scripts --max-warnings 0`
   - `npx vitest run lib` (two FX tests fail without network — that is
     pre-existing, everything else must pass)
   - `npx next build`

   These are the checks the subagents were told to skip, because running them
   after every step costs minutes a step and catches nothing this will not.
   Anything that fails here belongs to whichever step broke it: fix it, and
   amend or add a commit against that step's number.
7. **Push once**, then report: every step closed **by number and title**, what
   became ready, what is blocked and on what, and anything raised on
   `/dev/raised`, by title. A report that says "closed four steps" makes the
   person go and look.

If the batch ends before the steps do — something blocked, or you are running
short — say exactly which steps are left and that they are still handed over.
Do not close what was not built, and do not leave a step `in_progress` behind
you.

## The other jobs

Each is one file. Read the one you were sent for; do not read the others.

| | |
|---|---|
| `reference/building.md` | Building one step, start to close. What a subagent reads. |
| `reference/shaping.md` | Turning an idea into a proposed feature. |
| `reference/reshaping.md` | Re-reading a feature against the answers beneath it. |
| `reference/comments.md` | Answering a comment that tags `@dash`. |
| `reference/writing.md` | How to write a title and a detail. Read before writing any row. |
| `reference/raising.md` | The four places something a session has to say can go. |
| `reference/dismissed.md` | What the person has put aside, and why you never bring it back. |
| `reference/offline.md` | The SQL to use when `DATABASE_URL` is missing. |

## Statuses

| Status | Meaning |
|---|---|
| `proposed` | Written by a session from an idea. Waiting on the person. Never built. |
| `not_started` | Decided on, not begun. |
| `in_progress` | Claimed right now. At most one at a time. |
| `blocked` | Needs an answer or something outside the repo. Reason required. |
| `done` | Shipped, verified against its done-when. Carries the commit. |
| `dropped` | Decided against. Reason required. |

Waiting on another step is not a status — it is a row in `plan_dependencies`,
and it clears itself when the other step is done. Do not mark a step
`blocked` for that; add the dependency instead.

"Out of scope" is not a status either. It is `drop <n> --note "out of scope:
…"`, which reads the same and needs no sixth column.

## Kind and fog

Beside the status, two columns say what a step is rather than where it stands.

| | Meaning |
|---|---|
| `kind` | `build`, `decision` or `setup`. A build step closes on a commit; a decision closes on the person's answer, recorded in `resolution`; a setup step closes when the person says they have done the thing outside the repo, and carries no commit. It is a kind and not a status because all three move through the same states — not started, blocked, dropped — and differ only in what closing them means. |
| `dismissed_at`, `fog_dismissed_at` | Put aside by the person as not right now — the row itself, and the patch of fog on it. Hidden everywhere but the Dismissed view. Never written by a session. See `reference/dismissed.md`. |
| `fog` | The "not yet specified" note: one paragraph admitting what cannot yet be seen well enough to write steps for. Allowed on any step, meaningful mostly on a feature. Written with `add --fog`, changed later with `fog <n> --note "…"`, and cleared with `fog <n> --clear` once the steps that dispel it exist. `reference/reshaping.md` is what does that clearing. |

Every answered decision beneath a feature is carried into the brief of every
step under it, under **Decided so far**. That is what it is for: ask once,
build against the answer forever after.

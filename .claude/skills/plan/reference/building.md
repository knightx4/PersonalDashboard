# Building one plan step

You have been given one step from the build plan by number. Build it, verify
it, commit it, close it, and report. You are not working the rest of the
feature — the session that sent you is, and it will send the next step once
you are done.

**The rule that matters: the plan must always tell the truth.** Never leave a
step in a state that misrepresents reality. If it cannot be finished, it is
`blocked` with the specific question — not left `in_progress` to look busy,
and not marked `done` because you are running out of room.

## The commands you need

`scripts/plan.ts` needs `DATABASE_URL` (service role) in the environment. If
it is missing, read `offline.md` in this directory instead of guessing.

```
npx tsx scripts/plan.ts show <n>               # the brief: destination, decisions, done-when, waits
npx tsx scripts/plan.ts start <n>              # claim it (in_progress); refuses a decision
npx tsx scripts/plan.ts done <n> --note "…"    # close it; records HEAD commit
npx tsx scripts/plan.ts block <n> --ask "…" [--on-steps] [--note "…"]
                                               # cannot proceed; the ask is the one sentence
                                               # saying what it needs, rewritten each time.
                                               # --on-steps: waiting on the steps it names, so
                                               # it clears itself when they close. Without it
                                               # the block waits for the person.
npx tsx scripts/plan.ts needs "<what to set>" --for <n> [--detail "…"]
                                               # something only the person can supply: writes a
                                               # setup step of theirs under the same feature and
                                               # makes <n> wait on it
npx tsx scripts/plan.ts reopen <n>             # put it back to not started
npx tsx scripts/plan.ts drop <n> --note "…"    # will not do; say why
npx tsx scripts/plan.ts add "title" --parent <n> [--done-when "…"] [--fog "…"]
                                               [--proposed] [--size s|m|l] [--from <n>]
npx tsx scripts/plan.ts add "the question?" --parent <n> --kind decision --detail "…"
npx tsx scripts/plan.ts depends <n> --on <m>   # n cannot start until m is done
npx tsx scripts/plan.ts fog <n> --note "…"     # what cannot be seen yet; --clear once it can
npx tsx scripts/plan.ts idea "…" [--module <id>] [--from <n>]
                                               # one close to an idea already filed is
                                               # refused; two an hour is the most you may file
npx tsx scripts/plan.ts raise "…" --ask "…" --consequence "<action>: <what>"
```

Steps are named by number — the `#12` on the page. Numbers are never reused.

## The loop

1. **Claim it first.** `start <n>`, before reading anything. `start` refuses a
   proposal and refuses a decision, so claiming first is also the cheapest way
   to find out the step is not yours.
2. **Read the brief.** `show <n>`. Read the "Done when" section twice; it is
   what the work is checked against. If there is none, write one from the
   detail and the parent's context before starting, and say so in the note.
   The brief also carries **Destination** — the feature's own done-when — and
   **Decided so far**, every question already settled beneath that feature.
   Build against those: they are the answers you would otherwise ask for
   again.
3. **Check what it waits on.** A brief that says "waits on #9 (still open)" is
   not ready, whatever you were told. Put it back — `reopen <n>` — and say so
   in your report.
4. **Break it down if it is large.** A step sized `l`, or one whose brief
   describes more than one sitting of work, gets sub-steps first
   (`add "…" --parent <n>`), each with its own done-when. Build the first, and
   report the rest so the next one can be sent. The plan is more useful with
   the breakdown in it than with the breakdown in your head.
5. **Make the change.** The smallest change that meets the done-when. Follow
   the repo's rules (`README.md` "Rules", the module's spec in `docs/`). Do not
   fold unrelated cleanup into a step's commit.
6. **Verify before closing.** Three, every time:
   - `npx tsc --noEmit -p tsconfig.json` — whole project, about 25 seconds. An
     edit in one file breaks types in another, so this is not narrowed.
   - `npx eslint <the files you changed> --max-warnings 0`
   - `npx vitest run <the test files covering what you changed>` — the ones for
     the code you touched, not the whole suite.

   Then check the done-when line by line. If a line is not met, it is not
   done.

   **Do not run the full suite and do not run `next build`.** The session that
   sent you runs both when it merges your step to main, which is as soon as you
   report the commit; CI runs them again on main. Running them here first would only run
   them twice. The exception is a step whose done-when is about the build or
   about a test that the narrow run cannot reach: run what the done-when needs
   and say so in your report.
7. **Commit the step on its own.** One step per commit. End the subject with
   the step: `Add the anonymous share page (plan #14)`. **Do not push and do
   not merge.** The session that sent you puts your commit on main and closes
   your step from there, so stop at the commit and say in your report that you
   made it. If nobody sent you and this step is the whole job, the merge is
   yours: the procedure is step 4 of the Building section in `SKILL.md`, and
   the merge comes before the close.
8. **Before closing, look up once.** If the feature above your step carries
   fog, and what you just learned makes it specifiable, write those steps now
   — `add "…" --parent <the feature> --proposed --done-when "…" --size s|m|l` —
   and clear the patch with `fog <the feature> --clear`. Proposed, always: they
   are a proposal like any other and wait for the same approve. Say in your
   report what you graduated and what you cleared.

   Most of the time the answer is no, and no is the right answer: you are
   heads-down on one done-when and will miss most of what a re-shape would
   catch. But it costs a glance, and it means fog can dissolve without anybody
   pressing anything.

   With the decision below, this is the **only** rewriting you do beyond your
   own step: your own decisions, and fog you can now specify. Nothing else — no
   reordering, no dropping somebody else's step, no rewriting a done-when you
   disagree with, and never an approve.
9. **Hand the close over.** `done` refuses a commit that is not on main, and
   yours is on a branch nobody has merged yet, so the session that sent you
   closes the step once it has merged. Write the note it should close with —
   what changed, in one sentence — and put it in your report. If nobody sent
   you, merge first and then close it yourself: `done <n> --note "…"`, which
   records the commit from HEAD and names any steps that became ready.

## What to report back

You are one step in a batch, and the session that sent you keeps none of what
you read. Your report is the only thing that survives you, so write it for the
session building the next step:

- **The step, by number and title, and what you did to it** — committed, with
  the sha and the note it should close with; blocked, and on what; or put back,
  and why.
- **What changed**, as files and what each now does. Not a diff; the next
  session can read the diff. Name what it would otherwise have to go looking
  for.
- **What the next step needs to know.** The thing you worked out that is not
  written down anywhere — a helper that already existed, a shape the data turns
  out to have, a test that has to be updated whenever this changes, a rule in
  the code that was not obvious. This is the part that stops the next step
  re-deriving what you just learned.
- **Anything you wrote outside your own step**: a decision and its dependency
  edge, fog graduated or cleared, an idea filed, a raise. By number and title.
- **Any step that became ready** when you closed yours.

Keep it to what the next session needs. A page is too long; three lines is too
short.

## When you reach something you should not decide

A design choice with two real answers, a cost worth somebody's opinion, a thing
the brief did not say — do not pick one and build on it. Guessing is cheap in
the moment and expensive later, because a guess built on looks exactly like a
decision from the outside.

Write it down instead, and stop:

```
npx tsx scripts/plan.ts add "Which shape for the export?" --parent <the feature> \
  --kind decision --detail "<the question, the two or three real options, what
  each costs, and which you would choose and why>"
npx tsx scripts/plan.ts depends <your step> --on <the decision>
npx tsx scripts/plan.ts block <your step> --on-steps \
  --ask "Which of the options on #<the decision>?"
```

`--on-steps` is what makes that block clear itself: the step is waiting on the
question you just wrote, the dependency edge names it, and answering it puts
the step back in the ready list without anybody unblocking it by hand. Leave
`--on-steps` off when the step is waiting on the person for something no row on
the plan will produce, and it stays blocked until they say otherwise. A key or
an account is not one of those: that is `needs`, in the next section, and it
writes the row and the edge for you.

Then report the block. Do not move on to another step; that is not your call.

The same two moves close out a merge that will not go through, when the merge
was yours because nobody sent you: push the working branch before you block the
step, and name that branch in the `--ask`. The work then outlives the session
that wrote it, and whoever picks the step up reads it instead of building it
twice. Leave the step open — its commit is on a branch, which is the thing
`done` refuses.

The recommendation is part of the job: a question with no proposed answer makes
the person do the reading you already did. What you must not do is act on your
own recommendation before they have agreed to it. **Never answer your own
decision** — not by running `answer`, not by writing the resolution into the
row, and not by building as though it had been settled.

**How a decision must be written.** The page shows a question in three parts —
the question, the options, the answer — and it can only do that if you write it
in three parts:

- **The title is the question**, as one sentence ending in a question mark. Not
  a topic. "Which shape for the export?" is a question; "Export format" is a
  filing label, and it is what the person has to answer from.
- **The options go in `--detail`, lettered, one option per line**, starting at
  `A` and running in order: `A — …`, then `B — …`. The letters are what turn
  the paragraph into options on the page and into one-click answers; prose
  options are shown as the prose they are. `(a)`, `A)`, `A.` and `A --` are
  read too. See `lib/plan/options.ts` for exactly what is recognised.
- **Each option opens with its own name in one short sentence.** That first
  sentence is what appears as the option; the cost and the reasoning follow it
  in the same paragraph and go under the fold.
- **Two or three options.** One is not a choice, and a set that skips a letter
  is read as prose rather than as options.

```
--detail "A — Ship it as CSV. One file, opens anywhere, loses the nesting.
B — Ship it as JSON. Keeps everything, needs something to read it.
Recommend A: the nesting is one column and nobody has asked for it."
```

A step that should not be done is `drop <n> --note "why"`; say "out of scope:
…" when that is the reason, since there is no status for it. Never delete a
step; deleting is the user's.

## When the step needs something only the user can supply

An API key, an account, a value set in somebody else's dashboard, a record in
DNS. That is not a wall you block on — it is a job of theirs that nobody has
written down. Write it:

```
npx tsx scripts/plan.ts needs "Set GITHUB_TOKEN in Vercel" --for <your step> \
  --detail "<where to go, what to click, what the value has to be>"
```

That writes two things. A `setup` step, assigned to the person, under the same
feature as your step, so it sits beside the work it is holding up. And the
`plan_dependencies` row from your step to it, so your step reads as waiting on
a row on the plan rather than as a session stuck. Closing the setup step is
then the whole of freeing your step: nothing has to be unblocked by hand. If
your step was already `blocked`, `needs` puts it back to not started and clears
the ask. Report both numbers.

**The title is the one-line summary and `--detail` is what to actually go and
do.** The page shows the title in a list and the detail in a box labelled
"What to set up", so instructions written as the title leave that box saying
nothing the heading did not.

A setup step is never yours. It closes when the person says they have done it,
on `/dev/plan` or in the Dash tab's "Waiting on you", and it carries no commit.
`start` refuses one, the same as a decision, and `next --claude` never lists
one.

`block <n> --ask "…"` without `--on-steps` is still right for the rest: the
person has to decide something or say what they want, and there is nothing you
could write instructions for. That is the test — if you can say what doing it
involves, it is a setup step; if what you need is their opinion, it is a block.
The ask is rewritten on every block, so it is what the step needs now; `--note`
is for anything else worth recording, and that is appended to the history in
the comment.

## The other two files you may need

- **`writing.md`** — how to write a title and a detail. Read it before you
  write any row: a sub-step, a decision, fog, an idea, or the note you close
  with.
- **`raising.md`** — the four places something a session has to say can go, and
  which one takes what. Read it when you have something to say that does not
  belong to the step in front of you.

## Statuses, kind and fog

- `proposed` — waiting on the person. Never yours to move.
- `not_started` — agreed, nothing has claimed it.
- `in_progress` — a session has claimed it and is on it. You set this with
  `start` and clear it by closing. It means one thing: somebody is on this
  right now.
- `blocked` — cannot proceed; the note says what is needed.
- `done` — closed against its done-when. Carries the commit.
- `dropped` — decided against; the note says why.

Waiting on another step is not a status — it is a row in `plan_dependencies`,
and it clears itself when the other step is done. Do not mark a step `blocked`
for that; add the dependency instead. "Out of scope" is not a status either: it
is `drop <n> --note "out of scope: …"`.

**Kind** is `build`, `decision` or `setup`. A decision is a question put to the
person, and it is never yours to answer, however it is assigned and whoever
named it. A setup step is a job of theirs outside the repo, written with
`needs`; it closes when they say they have done it and carries no commit.
Neither is ever closed by a session.

**Fog** is one sentence on a feature: what cannot be seen yet about finishing
it. `done` refuses a feature that still carries fog, so fog is cleared by
graduating it into steps (step 8 above), not by ignoring it.

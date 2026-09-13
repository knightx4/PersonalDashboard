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
npx tsx scripts/plan.ts block <n> --note "…"   # cannot proceed; say what is needed
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
                                               # you were on when you thought of it.
npx tsx scripts/plan.ts idea --file <path.md>  # one idea per "## " heading
npx tsx scripts/plan.ts raise "…" --ask "…" [--detail "…"] [--module <id>] [--from <n>]
                                               # ask the person something. Never answered by you.
npx tsx scripts/plan.ts raises                 # open raises, and answers no session has replied to
```

Steps are named by number — the `#12` on the page. Numbers are never reused.

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

## The loop

One step at a time. Do not start the next until the current one is closed.

1. **Claim it first.** `start <n>`, before reading anything. Two routines can
   be awake at once, and the seconds spent reading a brief are exactly the
   window in which the other one takes the same step. `start` refuses a
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
   not ready, whatever `next` said a minute ago. Put it back — `reopen <n>` —
   and stop.
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
8. **Before closing, look up once.** If the feature above your step carries
   fog, and what you just learned makes it specifiable, write those steps now
   — `add "…" --parent <the feature> --proposed --done-when "…" --size s|m|l`
   — and clear the patch with `fog <the feature> --clear`. Proposed, always:
   they are a proposal like any other and wait for the same approve. Say in
   your report what you graduated and what you cleared.

   Most of the time the answer is no, and no is the right answer: you are
   heads-down on one done-when and will miss most of what a re-shape would
   catch. But it costs a glance, and it means fog can dissolve without
   anybody pressing anything.

   With the decision above, this is the **only** rewriting a build session
   does beyond its own step: its own decisions, and fog it can now specify.
   Nothing else — no reordering, no dropping somebody else's step, no
   rewriting a done-when you disagree with, and never an approve.
9. **Close it.** `done <n> --note "what changed, in one sentence"`. The commit
   is recorded from HEAD, so close after committing. The output names any
   steps that became ready as a result — mention them in the report.
10. **Push once per batch**, then report: every step closed **by number and
   title**, what became ready, what is blocked and on what, and anything you
   raised on `/dev/raised`, by title. A report that says "closed four steps"
   makes the person go and look.

### When you reach something you should not decide

A design choice with two real answers, a cost worth somebody's opinion, a
thing the brief did not say — do not pick one and build on it. Guessing is
cheap in the moment and expensive later, because a guess built on looks
exactly like a decision from the outside.

Write it down instead, and stop:

```
npx tsx scripts/plan.ts add "Which shape for the export?" --parent <the feature> \
  --kind decision --detail "<the question, the two or three real options, what
  each costs, and which you would choose and why>"
npx tsx scripts/plan.ts depends <your step> --on <the decision>
npx tsx scripts/plan.ts block <your step> --note "Waiting on #<the decision>."
```

The recommendation is part of the job: a question with no proposed answer
makes the person do the reading you already did. What you must not do is act
on your own recommendation before they have agreed to it.

**How a decision must be written.** The page shows a question in three parts —
the question, the options, the answer — and it can only do that if you write
it in three parts:

- **The title is the question**, as one sentence ending in a question mark.
  Not a topic. "Which shape for the export?" is a question; "Export format" is
  a filing label, and it is what the person has to answer from.
- **The options go in `--detail`, lettered, one option per line**, starting at
  `A` and running in order: `A — …`, then `B — …`. The letters are what turn
  the paragraph into options on the page and into one-click answers; prose
  options are shown as the prose they are. `(a)`, `A)` and `A.` are read too.
  See `lib/plan/options.ts` for exactly what is recognised.
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

Writing a decision means writing rows outside your own step, which is one of
the two places "one step at a time" gives way — the other being fog you can
now specify, in step 8 above. A decision, its dependency edge, and the block
on your own step: nothing else.

A step that turns out to need something else from the user — an API key, an
account, a thing outside the repo — is `block <n> --note "the question"`, with
the exact question. A step that should not be done is `drop <n> --note "why"`;
say "out of scope: …" when that is the reason, since there is no status for
it. Never delete a step; deleting is the user's.

## Raising something that belongs to no step

Four places take something a session has to say, and they are not
interchangeable:

- **A plan decision** — a `decision` step under one feature. A question about
  that feature, answered before it is built.
- **The notes queue** — `feedback_items`, `.claude/skills/notes`. What the user
  reported as wrong, or asked for.
- **An idea** — `ideas`, read on `/dev/ideas`, written with
  `idea "…" [--module <id>] [--from <n>]`. Work worth doing later that the
  feature in front of you can be finished without. This is where a follow-on
  goes; fog is not, and neither is a step invented under a feature nobody
  proposed it for. Anything the CLI files is marked as your suggestion and
  listed under the user's own ideas, so `--from <the feature>` is worth
  passing: it is what the page shows as where the suggestion came from. One
  the user dismisses stops being listed, including by `ideas`, so do not
  write it again.
- **A raise** — `raised_items`, read on `/dev/raised`. What a session ran into
  that belongs to none of those: a risk found in code it was only passing
  through, a question of taste, a thing it will not decide alone. Without it,
  that goes in the transcript, where it is only read by somebody who opens
  Claude.

The test is what the answer would change. If it changes how one feature gets
built, it is a decision under that feature. If it is something already shipped
being wrong, it is a note. If it is more work rather than a question, it is an
idea. If it is none of those and it still needs the person, it is a raise.

**Read the raises at the start of a run**, before claiming a step:

```
npx tsx scripts/plan.ts raises      # open ones, and answers no session has replied to
npx tsx scripts/plan.ts raise "…" --ask "…" [--detail "…"] [--module <id>] [--from <n>]
```

An open raise is the person still waiting to be asked; an answered one carries
a reply written while nothing was awake, and that answer is what to build
against from then on. `--from <n>` stamps the step you were on, which is what
makes a raise legible a week later.

**`--ask` is required, and it is the row.** The title says what it is about and
the detail is the evidence; the ask is the move you want back, in one sentence
the person can answer in one line — a question with your recommendation, an
action to approve, or a choice between named options. Without it a raise reads
as a session narrating, the page fills with paragraphs nobody can clear, and
the person cannot tell what is being asked. "Should the merge to main run tsc
and next build before it lands? I would; it costs a minute and catches a broken
main." — not "worth deciding whether the merge should run the gate."

**A session never answers or dismisses a raise**, the same rule as never
answering its own decision. Replying to an answer the person wrote is the
exception, and it is a `claude` comment on the thread, not a close.

A raise is not a way past a step that needs a decision. A step blocked on a
question about the feature it belongs to gets that decision written under the
feature, per **When you reach something you should not decide** above.

Say in the report, by title, anything raised during the run — a question
nobody knows is waiting is the failure this exists to prevent.

## Not right now

A question the person does not want to settle yet, a patch of fog they do not
want raised again, and a suggestion they are not taking are all **dismissed**
rather than answered, cleared or deleted. Dismissing hides the row — off the
plan page, out of the counts, out of `next` and `list`, out of every brief and
every re-shape turn — and keeps it under the **Dismissed** view on `/dev/plan`
and the **Dismissed** section on `/dev/ideas`, where it can be brought back by
hand. Nothing surfaces on its own. That is what #340 settled.

Three rules, and they are the same rule as never answering your own decision:

- **Never dismiss anything.** Not a question, not fog, not a suggestion. A
  session that can put its own questions out of sight has no questions.
- **Never bring one back.** If a dismissed question turns out to block the work
  in front of you, say so — `block <n> --note "…"` on your step, naming it.
- **Never write it again.** A re-shape is handed what was dismissed under the
  feature, under *Already dismissed*. Do not propose it again, do not ask the
  same question in different words, do not write it back as fog, and do not
  file it as an idea. The loop this ends is the plan asking the same thing
  every time anything reads it.

A dismissed patch of fog does not hold a step open: `done` refuses fog, but not
fog that has been put aside. Rewriting a patch — `fog <n> --note "…"` — clears
any dismissal on the old one, because the new sentence is not one anybody has
put aside yet.

## How to write a title and a detail

Steps get read months later, by a person deciding what to build and by a
session about to build it. Both need to know what the step is from the title
alone. A lot of the plan currently fails that, so this is a rule, not advice.

**The title says what will be true when the step is done.** Name the thing
being built and where it goes. Aim for under about eight words. If you cannot
say what the step produces, you do not understand it well enough to write it
yet.

| Instead of | Write |
|---|---|
| The record that a pass happened | Store the result of each UI review |
| Read a briefing into claims you do not hold yet | Extract claims from a pasted briefing |
| Map a search hit to the thing a task can point at | Link a search result to a task |
| Re-shaping: the plan adapts as decisions land | Re-shape a feature after its questions are answered |

**The detail says what the work involves.** Which files, which tables, what
already exists, what has to be added. Two to five sentences.

**But the first sentence is for the person, not for the next session.** They
own the app and read this page to decide what gets built; they are not going
to open `lib/ideas/load.ts` to find out what a step is. So:

> **Sentence one says what will be different for the person, and names
> nothing from the codebase** — no file paths, no table names, no type or
> function names. Then the rest of the detail is as technical as it needs to
> be.

This is the rule the plan kept failing. Details like *"lib/raised/load.ts,
following lib/ideas/load.ts and lib/feedback/load.ts: a RaisedRow type in the
app's own shape, a loader that takes a client and a user id…"* are accurate
and tell the person nothing. That step's first sentence is *"The dev pages can
show what Claude has raised, open ones first."* Then the paths.

| Instead of opening with | Open with |
|---|---|
| `app/dev/raised/page.tsx` with a PageHeader and a client view, plus actions.ts holding… | A new Raised tab lists what Claude needs from you, and you can dismiss a row or bring it back. |
| A section in `.claude/skills/plan/SKILL.md` naming the three homes and the difference… | Sessions learn when to raise something to you instead of burying it in a transcript. |
| `scripts/plan.ts` gains two commands using the `connect()` and `resolveUser()` it already has… | A session can write something down for you and read your answer back later. |

A quick check before writing the row: read your first sentence back and ask
whether somebody who has never opened this repository would know what they
are getting. If not, it is not written yet.

**Do not write:**

- Stock phrases and slogans. "the source of truth", "in one breath", "the
  whole point", "what this exists to prevent".
- Metaphor for machinery. A button is not a rope, a queue is not a river,
  data does not travel. Say what the code does.
- Titles built on a colon, or a pattern like "X, and what it means for Y".
- Claims of significance. Not "this is the step that matters"; the plan does
  not need to be sold to the person who wrote it.
- Hedging that carries no information. "arguably", "it may be worth
  considering", "somewhat".
- Sentence structures that need re-reading. One clause after another with
  dashes and semicolons holding them together is harder to read than three
  sentences.
- Abstractions with no referent. "the experience", "the flow", "adaptive
  behaviour", "a first-class concept".
- Restating the title in the first line of the detail.

**Do write** the way you would explain the step to somebody sitting next to
you: plainly, with the specifics in it, and no more words than the thing
needs. Ordinary technical English. A step that reads as though nobody wrote
it is worse than a blunt one.

The same applies to a decision's question and its options, to fog, and to the
note you close a step with.

## Shaping an idea

The second job. An idea on the ideas page is a sentence; the plan needs a
feature with steps, and writing that well takes knowing the code. So when the
user says "shape idea …", or a routine is fired from the *Shape into a plan*
button with an idea in its brief, the job is to write a **proposal** — and
nothing else.

1. **Read the idea.** `ideas` lists the ones not yet shaped, with their id
   prefix. The brief a routine was fired with carries the full text.
2. **Read the code it touches.** The module's spec in `docs/`, the routes and
   lib directories it would change, the tests that would need to grow. Decide
   what already exists, what has to be added, and in what order.
3. **Write the feature.** One top-level step for the idea, in its module:

   ```
   npx tsx scripts/plan.ts add "<the feature>" --module <id> --proposed --idea <prefix> \
     --size l --detail "<what it is, in two or three sentences>" \
     --done-when "<what being finished means, from the user's side>"
   ```

   `--idea` links the idea to the feature, which is what turns the idea's
   button into "in the plan as #n". Do this on the feature, not a step.
4. **Write the steps beneath it**, each `--parent <n>` and each with a
   `--done-when` and a `--size`. Steps under a proposed feature are proposed
   automatically. Three to eight steps is the usual shape; a step sized `l`
   should be split. Order them the way they would be built, and add
   `depends <n> --on <m>` where one genuinely cannot start before another.
   Put migrations and schema first, the page last, and the tests inside the
   step they test rather than as a step of their own.

   **Do not pad to a step count.** Three real steps and an honest gap beat
   six, three of which were invented to look complete. What goes in the gap
   is a decision, fog, or an idea, and two tests in order say which.

   > **First: if this question is never resolved, is the feature still
   > finished?**
   >
   > Yes → it is a follow-on, not a gap in this feature. File it on the ideas
   > page — `idea "<the follow-on>" --module <id>` — and name it in the
   > report. Whether the thing you are building should later work somewhere
   > else, whether it will still be right in six months, what a neighbouring
   > feature should do with it: all of these are follow-ons. **They are not
   > fog.** Written as fog they sit on a feature that ships without them and
   > nothing reads them again.
   >
   > No, and it can only be settled once part of this feature exists → it is a
   > real gap, and the second test says which kind.

   > **Second: can the question be phrased sharply, right now?**
   >
   > Yes → it is a **decision**. Write it as a step:
   > `add "…?" --parent <n> --kind decision --detail "<the two or three real
   > options, lettered from A, one per line, each opening with its own name in
   > one sentence and carrying its cost after it; then your recommendation>"`,
   > and `depends` the steps that cannot start until it is settled. Written any
   > other way it reaches the person as a paragraph rather than as a choice —
   > see **How a decision must be written** above.
   >
   > No → it is **fog**. Put it on the feature: `--fog "<what is not yet
   > known, and what would have to be found out>"`. It graduates into steps
   > once somebody can see far enough to write them, and is cleared then.

   The second test is *not* whether you can answer the question. A question
   you could answer yourself is still a decision if it is the person's to
   make; a question nobody can answer yet is still a decision if it is sharp.

   **One patch of fog per feature.** `fog` is one column, so a second one
   replaces the first rather than joining it. A feature that seems to need two
   has at most one: the other is a decision, or it is a follow-on and belongs
   on the ideas page.
5. **Say what you are unsure of** in the feature's `--detail` as well: the
   costs, the trade-offs, the thing the idea did not say. A proposal that
   hides its open questions gets approved with them still open. A decision
   is the sharp end of that; the detail is for what does not fit the shape.
6. **Stop.** Do not `start`, do not `approve`, do not `answer` your own
   decisions, do not assign anything to Claude, do not write code. Report the
   feature and its steps **by number and title**, and the questions. The
   person approves on `/dev/plan`, and only then does the building loop above
   apply.

If the idea is already in the plan (`ideas` does not list it), say so and
stop rather than shaping it twice. If the idea is really a bug or a one-line
request, say that it belongs in the notes queue instead, and stop.

## Re-shaping a feature

The third job, and the return trip. Shaping runs once, before anything is
built; from then on the feature is a fixed drawing of a thing that is still
moving. An answer settles a question and changes nothing else, fog written at
shaping is never read again, and a step the answer made pointless goes on
looking live until somebody notices.

So when the user says "re-shape #95", or a routine is fired from the
**Re-shape** button with a re-shape turn, the job is to read the feature
against everything now known and write down what has changed — as
**proposals**, and nothing else.

1. **Read the feature.** `show <n>`: its done-when, its fog, its open steps,
   and *Decided so far* — every question settled beneath it. Then read the
   code those answers touch. An answer changes what is buildable only if you
   know what is there.

   **A feature that is already `done` or `dropped` takes no new rows.** Its
   status says it is finished, and a proposal appearing inside it reads as the
   feature having re-opened itself. Re-shaping one is still legitimate — an
   answer can land under it long after it closed — but everything the re-shape
   turns up there is *new work*, so it goes at the top level:
   `add "…"` with no `--parent`, a detail that opens by saying it came out of
   `#<n>`, and the steps and questions under **that**. The one write a
   re-shape may still make to the closed feature is `fog <n> --clear`, and
   only once the new feature that dispels the fog exists.
2. **Graduate the fog.** If an answer, or the code, has made the fog
   specifiable, write those steps now: `add "…" --parent <n> --proposed
   --done-when "…" --size s|m|l --from <the decision>`, and clear the patch in
   the same breath with `fog <n> --clear`. **`--from` on every row a re-shape
   writes**: it stamps the step with the answer that produced it, and a
   proposed step appearing under a feature somebody approved last week is
   confusing until it says why it is there. The gist is read off the
   decision's own answer, so it cannot be paraphrased into something nobody
   said. Fog that is *still* fog stays exactly as it is — a patch
   rewritten into something vaguer is worse than one left alone. If part of it
   has cleared and part has not, `fog <n> --note "…"` with what is left.
3. **Say what an answer invalidated.** A step an answer made pointless is
   `drop <n> --note "…"`, naming the answer that did it and why: "#63's answer
   settles this on the server, so the client half is not needed." A re-shape
   may drop, and must always say why. If you are not sure the step is dead,
   it is not: say so in the report and leave it alone.
4. **Write the new questions.** An answer usually surfaces the next question.
   If it can be phrased sharply, it is a decision: `add "…?" --parent <n>
   --kind decision --from <the decision it came out of> --detail "<the real
   options, lettered from A, one per line, each with its cost; then your
   recommendation>"`. If it cannot, it is fog on the feature — but only if the
   feature is unfinished without it. A question the feature can ship without is
   a follow-on: file it with `idea "…"` and leave the feature alone. Same two
   tests as shaping, the same one patch of fog, and the same three parts to a
   decision — see **How a decision must be written**.
5. **Stop.** Do not `approve`, do not `answer` a decision, do not `start` or
   build anything, and do not re-propose what the feature already holds —
   read the existing steps first, including ones an earlier re-shape added,
   and everything under *Already dismissed*, which is what the person has
   turned down and is not to be written back in any form.
   Report what you proposed, what you dropped and why, what fog you cleared,
   and anything you noticed and deliberately left alone, all **by number and
   title**.

The contract this rests on: a re-shape writes proposed rows. The plan adapts
continuously, and nothing changes without an approve — the same review, from
a second direction.

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

-- a proposal, when shaping (steps beneath: same, with parent_id set)
insert into plan_items (user_id, module, title, detail, acceptance, size, status, position)
values ('…', 'shopping', '…', '…', '…', 'l', 'proposed', 10)
returning id, number;
update ideas set plan_item_id = '<the feature id>' where id = '<the idea id>';

-- a decision, when shaping: the question, its options, your recommendation.
-- Fog goes in the `fog` column of the feature the same insert creates.
insert into plan_items (user_id, module, parent_id, title, detail, kind, status, position)
values ('…', 'shopping', '<the feature id>', '…?', '…', 'decision', 'proposed', 20);

-- start (never on a proposed step, never on a decision)
update plan_items set status = 'in_progress' where id = '…';

-- done (after committing, so HEAD is the commit that did it)
update plan_items
set status = 'done', commit_sha = '…',
    comment = coalesce(comment || E'\n\n', '') || 'Done <date>: …'
where id = '…';

-- answer: the person's move, never a session's. Here to be recognised, not run.
update plan_items
set status = 'done', resolution = '<their words>', commit_sha = null,
    comment = coalesce(comment || E'\n\n', '') || 'Answered <date>: …'
where id = '…';

-- fog: write it, or clear it once the steps that dispel it exist. Not a
-- status change, so no dated line goes in the comment. Writing a new patch
-- clears any dismissal on the old one, which is the person's, not yours.
update plan_items set fog = '…', fog_dismissed_at = null where id = '…';

-- dismissed: put aside as not right now. Here to be read, never written.
-- `dismissed_at` is the row itself -- a question they are not answering --
-- and `fog_dismissed_at` is the patch of fog on it; `ideas.dismissed_at` is
-- a suggestion they are not taking. Leave every one of them out of what you
-- read the plan for, and never write one back in another form.
select number, title, dismissed_at, fog_dismissed_at from plan_items
where user_id = '…' and (dismissed_at is not null or fog_dismissed_at is not null);

-- a row a re-shape wrote, stamped with the answer that produced it. The same
-- line `add --from` writes, and what the page and the brief read back; keep
-- the wording exactly, including the apostrophe, or it stops being found.
insert into plan_items (user_id, module, parent_id, title, acceptance, size,
                        status, position, comment)
values ('…', 'dev', '<the feature id>', '…', '…', 's', 'proposed', 30,
        'From #63''s answer: <that answer, first line>');

-- block: not finished, so no commit
update plan_items
set status = 'blocked',
    comment = coalesce(comment || E'\n\n', '') || 'Blocked <date>: <the question>'
where id = '…';

-- raise: what you need from the person, when it belongs to no step. `source`
-- says which run raised it and what it was doing; `module` is null for the app
-- as a whole. Never answer or dismiss one -- that is the person's move on
-- /dev/raised, the same as a decision.
-- `ask` is the move you want back, in one sentence answerable in one line;
-- the CLI refuses a raise without one and doing the insert by hand does not
-- make it optional.
insert into raised_items (user_id, module, title, detail, ask, source, status)
values ('…', 'dev', '…', '…', '…', 'plan #<n>', 'open')
returning id;

-- what is outstanding in both directions: what the person has not answered,
-- and what they answered that no session has replied to. Read at the start of
-- a run.
select r.id, r.title, r.detail, r.ask, r.module, r.source, r.status, r.created_at,
       (
         select json_agg(json_build_object('author', c.author, 'body', c.body)
                         order by c.created_at)
         from dev_comments c where c.raised_item_id = r.id
       ) as comments
from raised_items r
where r.user_id = '…' and r.status in ('open', 'answered')
order by r.created_at desc;

-- replying to an answer, which is how a raise takes a second round.
insert into dev_comments (user_id, raised_item_id, author, body)
values ('…', '<the raise>', 'claude', '…');
```

`started_at` and `completed_at` are kept by a trigger from the status; do not
write them. A step is never closed without a note.

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
| `kind` | `build` or `decision`. A build step closes on a commit; a decision closes on the person's answer, recorded in `resolution`. It is a kind and not a status because a decision moves through the same states — it can be not started, blocked, dropped — and differs only in what closing it means. |
| `dismissed_at`, `fog_dismissed_at` | Put aside by the person as not right now — the row itself, and the patch of fog on it. Hidden everywhere but the Dismissed view. Never written by a session. See *Not right now* above. |
| `fog` | The "not yet specified" note: one paragraph admitting what cannot yet be seen well enough to write steps for. Allowed on any step, meaningful mostly on a feature. Written with `add --fog`, changed later with `fog <n> --note "…"`, and cleared with `fog <n> --clear` once the steps that dispel it exist. *Re-shaping a feature* above is what does that clearing. |

Every answered decision beneath a feature is carried into the brief of every
step under it, under **Decided so far**. That is what it is for: ask once,
build against the answer forever after.

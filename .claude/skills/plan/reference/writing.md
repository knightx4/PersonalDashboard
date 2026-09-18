# How to write a title and a detail

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


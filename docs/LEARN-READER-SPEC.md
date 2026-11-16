# Learn: the reader

Decided by the owner on 16 November 2026, after two months in which Learn was
barely opened. This spec describes what replaced Learn's front page and why.
Read with [LEARN-DIGEST-SPEC](LEARN-DIGEST-SPEC.md), which does the same thing
for lecture series.

## Why this changes

By mid November 2026 Learn had spent $188 on the API, $124 of it drafting
topics. It held 773 topics and 6,576 level write-ups. Of 457 lesson cards
written, 184 were dropped unseen, 96 were marked already known, and none had
its question answered. Nobody had taken a quiz or passed a piece. Learn had 26
page views in six weeks, none on a phone.

The owner gave the reasons. It cost too much. It was not enjoyable. The content
was generic. It did not show the right thing at the right time. There was no
quick way in on a phone. And there was a gap between broad generated summaries
and primary sources too hard to read unaided.

One design choice sat under all of these: Learn wrote a whole curriculum
before anyone asked for it, from a model's general knowledge, and waited to be
visited. The only thing opened in that last month was a set of seven readings
chosen against the owner's own vault notes.

## What the reader is

The unit is a real source: an essay, a paper, a chapter. It is prepared ahead
of time and read in layers.

1. **Context.** Who wrote it, when, and against what.
2. **In brief.** The whole work in a few sentences.
3. **The one idea.** A single sentence to take away.
4. **Sections.** Each opens to its own summary.
5. **The text.** The author's words, one press further in, with a note behind
   each hard phrase. A section also carries its own context and its own one
   idea, and sometimes a figure and a question.

A person can stop at whichever layer they have time for and still hold the
argument. The owner asked for the context at the start and the single idea at
the end after seeing a first mockup without them.

## Rules

**R1. Reading calls no model.** Opening Learn, opening a source, reading a
section and marking it read are database reads and writes. Checked by: the
actions in `app/learn/read/actions.ts` import no model client.

**R2. Preparation runs on the subscription, and only when asked.** A source
is prepared by a Claude Code routine following
`.claude/skills/learn-reader/SKILL.md`. A run starts when the owner asks for a
source, asks to go deeper, pastes a copy, or presses Find me more to read.
Nothing is scheduled, so a week away costs nothing.

**R3. The text is the author's.** Where a work is in the public domain or
openly licensed, it is shown in full and every paragraph is checked against
the stored full text when the source is saved (`checkSource`). Where it is in
copyright, no text is shown: the owner pastes their own copy and the source is
prepared again from it.

**R4. A summary says what it rests on.** `basis` is `text`, `read` (Dash read
the text and may not show it) or `memory` (written from knowledge of the work,
unchecked). The page says which.

**R5. Help sits beside the text and never replaces it.** A note names a
phrase that is in its section. A figure is shapes and words in the page's own
colours (`svgProblems`).

**R6. Nothing quizzes the reader.** There is no review queue. A section may
carry one question to think through, folded. What reading leaves is the list
of ideas met, each a way back to its passage.

**R7. Learning here is for its own sake.** What is shown does not follow the
owner's goals unless they ask. Sources come from four places: chosen against a
vault note, new ground the notes do not touch, something asked for by name,
and more on a section.

## Where things are

| Part | Where |
| --- | --- |
| The shape of a prepared source and its checks | `lib/learn/reader/source.ts` |
| How the front page sorts sources | `lib/learn/reader/shelves.ts` |
| The table | `learn.reader_sources` (learn 0195) |
| Queuing and firing the routine | `lib/learn/reader/request.ts` |
| The routine's commands | `scripts/learn-reader.ts` |
| Pages | `/learn/read`, `/learn/read/[id]`, `/learn/read/[id]/[n]`, `/learn/read/ideas` |

## What was built first, and what was not

Built on 16 November 2026: the four pages, the routine and its skill, and the
seven readings from the owner's vault notes, prepared by hand in the session
that built this. Two are public domain and shown in full (Innes, "What Is
Money?" and "The Credit Theory of Money"). One was read but may not be shown
(Toda). Four were written from memory of the work (Peters, Jacobs, Posner and
Weyl, Elster) and are labelled so.

Not built yet:

- Video clips as pieces. The clips already cut from the YouTube library are
  not on the reader's shelves.
- A thought typed under a section going to the vault note the source came
  from.
- A fixed share of new ground among what Find me more to read returns. The
  skill asks for two near the notes and two new each time, which is a ratio
  written in prose and not one the code holds.
- The old Learn. Now, Subjects, Essays, Reading lists and Videos are still
  there, and the hourly jobs behind them still run. Retiring them is its own
  step.

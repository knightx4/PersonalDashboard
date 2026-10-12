# Learn: what a card carries

Every thing Learn puts in front of the person, whether a card in Now, a
review, a lesson or a check, arrives with enough of its own history that it
reads as part of what they are learning. This document sets out what that
history is, how to test for it, and where Learn falls short today.

It was written on 12 October 2026, after studying Math Academy and Oboe.
Math Academy schedules reviews across a knowledge graph better than anything
else we looked at, and Learn is about to borrow that machinery. Andy
Matuschak, after months of using it, described the experience as "living
inside a database table": tasks arrive from a queue he cannot see, with no
history, no neighbours and no reason given, and progress is a set of
numbers. Learn should take the machinery and leave that experience behind.

Written to [WRITING-GUIDE.md](WRITING-GUIDE.md).

## The test

Take any screen in Learn and imagine each card on it replaced by a bare
row id. If the screen would still work, it is showing rows. A card passes
when replacing it with an id would lose something the person needs: where
it came from, what it connects to, or why it is in front of them now.

Apply the test to new screens before they are built and to changed screens
before they ship.

## What a card carries

### Where it came from

Every card names its source. When the person has their own trace of the
idea, the card names that as well: the note they wrote, the video they
saved, the earlier card it grew from. Feed cards already store `source` and
`why`. The vault is the trace no other learning tool has, and a card that
can point to it should.

### What it connects to

Where the graph or the card's `mentions` link the idea to something the
person has already met, the card can say so in one line: the idea it builds
on, or the note it agrees or disagrees with. It names only things the
person has seen. A link to a concept they have never met adds a row
without adding context, so it is left out.

### Why it is here now

A card that comes back says when and where the person met it: "You marked
this known on 3 October, from the article on bank runs." A check on a
prerequisite says which idea it is checking for. The reason is a sentence
about the person's history, never a count.

### A return comes from a new side

When an idea comes back, the question is asked from an angle the person has
not seen. `lib/learn/feed/return-angle.ts` already does this for Level 3
articles, taking a section no earlier card was cut from. Asking the same
question again is the fallback for when no other angle exists.

### Progress is written in the person's words

What builds up as the person learns is their own writing: card notes,
teach-back answers, and in time a short account per subject of what they
now understand. Learn adds no points, levels, streaks or leaderboards. The
subject progress bar in [LEARN-GRAPH-SPEC.md](LEARN-GRAPH-SPEC.md) stays,
because it reports what is known rather than how much was done.

### The person steers, and the goal holds

The person can always ask about a phrase, go deeper or follow a tangent.
Answering a detour returns them to where they were, and a detour never
changes a subject's goals or its plan. Oboe's founder describes the failure
this prevents: in a plain chat, one side question shifts the whole
conversation, and the original goal is lost.

## What stays a table

The schedule, the graph, each concept's state and each review's interval
are tables, and should be. This document governs what the person sees, and
it leaves those mechanisms alone.

The opposite failure is also real. A feed that gives every card rich
context and never asks the person to recall anything produces the feeling
of having learned without the memory of it. Math Academy's book calls this
the illusion of comprehension. Reviews stay scheduled and stay marked; this
document only decides how they are presented.

## Reviews in Now

Reviews will come into Now when ideas the person marks as known go on the
review schedule. When they do, each one is a card in the deck, mixed in with
the others:

- It shows where and when the idea was first met, and asks from a new angle
  where one exists.
- The person reveals the answer and marks it with one tap, had it or missed
  it.
- Skipping it moves it to another day with no penalty, and missed days do
  not pile up into a backlog.
- No more than `REVIEWS_IN_LEARN_NOW` appear in a day.
- A right answer says what the idea now supports, in place of the next
  interval.

## Where Learn departs from this today

- Now's waiting strip shows a count of ideas due for review
  (`lib/learn/feed/waiting.ts`). When reviews move into the deck, that line
  goes.
- Most concepts in Learn have no edges, so most cards have no connection to
  name yet. On 12 October 2026, 130 of 384 concepts had an edge.

## Rules

**R1.** Every card in Learn now names its source.
Checked by: audit.

**R2.** A connection shown on a card names a concept or note the person has
already met.
Checked by: audit.

**R3.** A card that brings an idea back says when and where the person
first met it.
Checked by: audit.

**R4.** Learn shows no points, levels, streaks or leaderboards.
Checked by: audit.

**R5.** A question asked from a card or a lesson never changes a subject's
goals or its plan.
Checked by: audit.

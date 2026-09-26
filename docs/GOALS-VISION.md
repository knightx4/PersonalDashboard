# Goals: what it is for

This page is the test every Goals change is checked against. The detail of how
things work is in [GOALS-SPEC.md](GOALS-SPEC.md); where the two disagree, this
page wins and the spec gets fixed.

## The job

Goals keeps track of what you are working towards, does the parts Claude can
do, and tells you what is left for you. A visit should take under a minute and
leave you knowing what to do next.

## What the home page answers

In this order, and nothing else above the fold:

1. **What should I do today?** Three to five things, ranked by what matters,
   each with one button: answer, approve, send, or mark done. When there is
   nothing, it says so.
2. **How is each goal doing?** One line per goal: a verdict (on track, stalled,
   waiting on you, or waiting on a date), how far along it is, and the next
   move with its date.
3. **What has Claude done?** What it finished, closed or changed since you last
   looked, each with an undo.

Everything else is on the goal's own page, one tap away.

## What you see

Three things: **goals**, **steps** and **questions**. An area is a heading that
groups goals. A stage is a step with steps under it. A rhythm is a step that
repeats. Collections, context, help kinds, fog and the rest are how Claude
keeps its notes; you see what they produced ("Balance $204,385, from the
Edfinancial statement"), never the container.

A new concept you would have to learn needs a strong case, and it should
usually replace one.

## What Claude does without asking

- **Works its own steps** and stores what each produced on the step.
- **Closes steps from evidence**: a confirmation email, an application logged
  in Jobs, a meeting that has passed. It says what it saw and offers an undo.
- **Keeps the map clean**: merges duplicate steps, drops ones an answer made
  pointless, and closes a stage when its steps are done.
- **Moves stale steps**: a step of yours untouched for a week gets split into
  something smaller, prepared for you (drafted, looked up, filled in), or
  turned into a question asking whether you still want it.
- **Settles what it can** and asks only what it cannot, with its
  recommendation first.

## What waits for you

- Anything that acts outside the app: sending, submitting, booking, buying,
  posting.
- Closing or parking a whole goal. Claude proposes it with a summary when the
  done-when is met or the goal has sat for three weeks.
- Changing a goal's done-when.
- Answers only you know.

Reversible things use undo. Approval is kept for what cannot be taken back.

## How it should feel

Calm and short. Finished work disappears from view. One line per goal carries
the status, so you rarely need to open the tree. Nothing on the page describes
how the system works.

## How we know it is working

- You open it most days.
- Few of your steps go a week without moving.
- More things are closed by Claude than wait on you.
- A stalled goal gets a move within a week.

The weekly run reports these on the Goals page.

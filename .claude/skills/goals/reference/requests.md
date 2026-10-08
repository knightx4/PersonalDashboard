# Steps sent from their row, and comments

Part of the goals skill. Read [../SKILL.md](../SKILL.md) first: it has how
every write is labelled, the run row, what you may change, and the index
saying which file holds each section named here.

## A step or phase sent from its row

The person pressed **Ask Dash** on one step or one phase on the goal page
(`lib/goals/handover.ts`). The brief names that step first, then its goal,
where it sits, the steps beside it, a phase's own steps, and the collections
the goal fills, and the run row has `job` `step` or `phase` with `item_id` on
the step. The app has already refused a question, a proposal, a step on a goal
that is not approved, and a step Claude is already on, so what you are sent is
yours to work.

The same run starts when the person writes `@dash` on a step asking Claude to
take it ("do this", "draft this for me"; `lib/goals/ask.ts`). Then the brief
also carries what they wrote, under "What they wrote", and what was said on
the row before it, where the links, file names and details the ask leans on
usually are. Treat anything in them about what to produce or how (shorter,
more formal, addressed to someone) as part of the step's done-when. The quick reply has already said in the thread
that the run started, so there is nothing more to write there. The person can
also type a line in the box beside Ask Dash on the row; it reaches the brief
under "What they wrote" in the same way, read the same way.

- **A step** (`job` `step`): work that one Claude step as in "The morning
  run", including the next move it leads to (point 5 there), and touch no
  other step. If it turns out to need something only the
  person has, block it with `block_ask` rather than guessing.
- **A phase** (`job` `phase`): work the open Claude steps in it, in order, as
  in "The morning run". Leave the person's own steps and the questions alone.
  The goal is approved, so where the phase plainly needs a Claude step it does
  not have, you may add one under it. Stop at the first step that needs the
  person.

The summary names each step worked and each one left, with the reason.

## Replying to a comment

A comment tagged `@dash` on a goal or a step is answered by a quick model call
in the app. When that call cannot do it from the goal alone (research, email,
changing steps), it fires this routine on the goal with the comment in the
brief: which goal or step it is on, the thread so far, and the insert that
puts your reply in the thread (`core.add_thread_turn`, under `goals.items:<id>`).

- A question is answered, and only answered. Write one reply and stop.
- A comment that asks nothing and wants nothing done (a status update,
  thanks, "looks good") needs no written reply. Mark it seen with
  `select core.acknowledge_thread_turn('<user>', 'goals.items:<id>', '<turn id>');`
  (the turn id is on `core.thread_turns` for that ref), or reply in one
  sentence. Never mark a question or an instruction, and never mark after you
  have changed anything in this run: what you changed is always written out in
  the reply. "Pushed the fix, all good now" and "thanks, that's what I needed"
  are marked; "looks good, can you move it to Friday?" is done, then answered
  in words; "done with this one?" is answered.
- An instruction is carried out inside "What you may change", then reported
  in the thread. Anything outside those rules, or anything that is the
  person's move (answering a question, approving, closing or dropping a step
  of theirs, deleting), is not done; say so in the reply and where on the page
  they do it.
- Work you can do that a step of theirs describes ("review my resume and
  LinkedIn", "you do this instead of me") is an instruction, never their move.
  The quick reply passes it on when the step is a phase with nothing of
  Claude's in it. Add a Claude step under that phase for the work (for example
  "Review your resume and LinkedIn profile"), with the links and file names
  from the thread in its detail, work it in this run as in "The morning run",
  and store what it produced on it. Leave their steps as they are. Where their
  done-when names someone else ("one outside review"), ask in the reply whether
  your pass counts toward it rather than changing it.
- A page you cannot read (a LinkedIn profile behind its login, a file not
  shared with the account) is said plainly in the reply with what would work
  instead, such as the profile saved as a PDF (More, then Save to PDF, on the
  profile) and put in their Drive.
- Facts the comment gives for a collection are filed as drafts, with
  `source = 'comment'` and `source_ref` the comment's id, for the person to
  confirm on the step. Never confirm one.
- Write the reply with `author = 'claude'`, in the same call as the actor and
  run settings. The database refuses a Claude write of any other author, and
  refuses Claude deleting a comment the person wrote.

Close the run row as for any other run; the summary says what you replied and
what you changed.

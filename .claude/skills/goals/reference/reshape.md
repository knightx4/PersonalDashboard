# Re-shaping after answers

Part of the goals skill. Read [../SKILL.md](../SKILL.md) first: it has how
every write is labelled, the run row, what you may change, and the index
saying which file holds each section named here.

When questions under the goal have a `resolution`:

- Settle the provisional steps that hung on each answer. One the answer bears
  out loses its `Provisional:` line. One the answer changes is rewritten to
  fit. One the answer made pointless is dropped (`status = 'dropped'`). An
  older provisional step still `proposed` under an approved goal goes to
  `open` once settled.
- Write any new steps the answer made clear, in the phase they belong to.
- Update or clear the goal's `fog`.
- Ask a new question only if an answer opened one. Never re-ask one the person
  answered, or one they put aside.
- A provisional step of the person's kind (`mine` or `rhythm`) is not yours
  to drop: rewrite it to fit the answer and take the line off, and if the
  answer makes it pointless, ask whether to drop it as a question that the
  step waits on. Once they answer that they do not want it, drop it with
  `dropped_on` (see "Moving a step that has sat for a week").

### The re-shape run

Answering a question fires a run by itself: a tick every ten minutes
(`inngest/goals/reshape.ts`) finds goals whose questions were answered since
their last run, waits until the latest answer is ten minutes old so answers
given together start one run, and fires the routine with the `goals.runs` row
it wrote with `job` `reshape`. The brief names the goal, each question
answered and its answer, and the provisional steps whose `Provisional:` line
names one of those questions.

Do what "Re-shaping after answers" says for those answers, and nothing else:

- Settle every provisional step that hangs on them, including any the brief
  missed because its line names the question in other words.
- Write anything new as you would on a mapping run: `open` under an approved
  goal, `proposed` under one that is not, and `proposed` with `acts` for a
  step that acts outside the plan. Judge each `mine` step you write or
  rewrite as in "A Dash step before yours".
- Do not map the goal again, do not work `claude` steps (that is the morning
  run), and do not search Gmail unless an answer asks for facts you now need.

The summary names each provisional step and what happened to it: settled as
it stood, rewritten, or dropped.

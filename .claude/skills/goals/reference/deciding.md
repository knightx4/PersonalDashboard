# Deciding, asking and provisional steps

Part of the goals skill. Read [../SKILL.md](../SKILL.md) first: it has how
every write is labelled, the run row, what you may change, and the index
saying which file holds each section named here.

## Decide first, ask last

The person wants a plan they can act on, not a set of choices to make. Every
question you ask is work handed back to them, so the default is to decide.
Where you would have written options with a recommendation, the
recommendation is usually the answer: take it and write the map for it.

**Decide it yourself** when any of these holds:

- A source already answers it (a note, a thought, an earlier answer, the
  goal's own detail), or points one way.
- One option is the plain first move: the cheapest, the lowest commitment, the
  one the person's other goals already lead into. Starting with it does not
  shut the others out.
- The choice is easy to change later. A first pick of format, venue, order,
  tool or reading list can be revised in a week; that is a decision, not a
  question.
- It is a matter of method: how to research, draft, schedule or split the
  work.

**Ask** only when all of these hold:

- The answer is something only the person holds: a fact no source records
  (a balance, a date, a name), or a preference about their own life that no
  source speaks to and that you cannot reasonably infer.
- The wrong guess would cost something real: money, a commitment to another
  person, a step that is hard to undo, or a plan built around something they
  do not want.
- No option is the plain first move.

A fact the person holds goes on an information step with a collection, not a
question. Questions about another person in their life (a partner, a family
member), about money beyond small sums, or about which life they want (which
career, which city) usually pass the test. Questions of format, order and
where to start usually do not: "Testimony, writing or something visual?"
under a goal to put something of one's own into the conversation is decided
by picking testimony, the lowest-commitment option that the person's
community board goal already leads into.

**Write the decision on the steps it shapes.** Each step built on it opens its
`detail` with one line

```
Decided: <the choice>, because <the reason in one clause>.
```

and then the step. The step goes in as it would after an answer: `open` under
an approved goal, `proposed` under one that is not. The line tells the person
what you chose so they can change it by turning the step down or commenting
on it; nothing else is needed from them. The run summary lists each decision
you made.

Rarely more than one question per goal on a run, and most runs ask none. A
goal whose map is all questions has not been planned.

**Withdraw your own questions that fail the test.** On a mapping or area run,
read the goal's open `decision` steps with no `resolution`, including ones
put aside with Not now. One you or an earlier run wrote that you would not ask
today is decided now: write the steps it shapes with the `Decided:` line,
settle any provisional steps that hung on it as a re-shape would, and drop the
question (`status = 'dropped'`). Leave a question the person wrote (its insert
in `goals.history` has `actor = 'me'`), and one that passes the test.

## Questions

When a question passes the test above, ask it once. A question
is a step with `kind = 'decision'`, `status = 'open'`, in the phase where the
answer is needed:

- **The title is the question**, one sentence ending in a question mark.
  "Avalanche or snowball?" is a question; "What are your goals?" is not one.
- **The `detail` holds the options, lettered from A, one per line**, each
  opening with its name in a short sentence and then what it leads to:

  ```
  A — Avalanche. Pay the highest rate first; least interest overall.
  B — Snowball. Pay the smallest balance first; a loan gone sooner.
  Recommend A: the rates run from 3.7% to 7.1%, so order matters.
  ```

  Two or three options, then which you would pick and why. The page draws
  each option as a button with your recommendation marked. **The database
  refuses a question from you whose detail has fewer than two lettered
  options** ("A — ", "A) ", "A. ", "A: ", "(a) " all count; the letters must
  run A, B, C in order).
- A question already on the goal with no options (written before this rule)
  gets them: update its `detail` to the lettered form. That is allowed on a
  question with no answer yet, and it is not asking it again.

## Provisional steps

A step that depends on an unanswered question is **written anyway, as
provisional**: `open` (or `proposed` under a goal that is not approved), with
a `detail` that opens with the line

```
Provisional: depends on "<the question's title>".
```

and then the step as you would write it for the answer you recommend, and a
row in `goals.dependencies` making it wait on the question ("Blocked and
waiting steps"). Answering closes the question, so until then the step reads
Waiting and stays out of the morning run, and the person has nothing to
approve. Put it where it belongs on the path, not under the question.

This replaces leaving such steps out. Use the goal's `fog` only for what you
cannot write even provisionally, in one or two plain sentences, and clear the
fog once the map covers it.

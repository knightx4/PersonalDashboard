# Raising something that belongs to no step

Five places take something a session has to say, and they are not
interchangeable:

- **A plan decision** — a `decision` step under one feature. A question about
  that feature, answered before it is built.
- **A setup step** — a `setup` step under the feature that ran into it, written
  with `needs "…" --for <n>`. Something only the person can supply for work
  already on the plan: an API key, an account, a value set somewhere you cannot
  reach. The command writes the dependency too, so the step that stopped is
  waiting on a row they can close rather than on a sentence buried in its own
  ask.
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
built, it is a decision under that feature. If it is not a question at all but
an errand you could write the instructions for, and a step is stopped until it
is done, it is a setup step. If it is something already shipped being wrong, it
is a note. If it is more work rather than a question, it is an idea. If it is
none of those and it still needs the person, it is a raise.

A decision and a setup step are told apart by what closes them: a decision
closes on what the person says, a setup step on their having gone and done
something. Asking them to choose between two libraries is a decision; asking
them to put a token in Vercel is a setup step.

**Read the raises at the start of a run**, before claiming a step:

```
npx tsx scripts/plan.ts raises      # open ones, and answers no session has replied to
npx tsx scripts/plan.ts raise "…" --ask "…" --consequence "<action>: <what>"
                                    [--detail "…"] [--module <id>] [--from <n>]
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

**`--consequence` is required too, and it is what a yes does.** Written as
`<action>: <what it works on>`, using the same action names a comment
instruction uses — `file_idea`, `file_note`, `add_step`, `build_step`,
`send_step`. Answering yes runs it, so the raise produces something rather than
closing into a thread nobody reads back: `--consequence "file_idea: Refuse a
second session on a step already being worked"`. A raise whose action you
cannot name is one that is not ready to be asked.

Where the answer is a piece of work, the two that write it are the ones to
weigh. `add_step` leaves it on the plan as a proposal for them to approve and
send — right when what to build still needs shaping, or is bigger than a
sitting. `build_step` writes the step ready to be worked and hands it to a
session in the same press — right when the raise already says what the work is
and the only question left is whether to do it, which is exactly what a yes
answers. Both take the step's name as the text; the paragraph under it is the
raise's own detail, and the workspace is the raise's unless you name another.
`send_step` is for work already on the plan, named by number: `--consequence
"send_step: #342"`.

**A session never answers or dismisses a raise**, the same rule as never
answering its own decision. Two things it does do. Replying to an answer the
person wrote is a `claude` comment on the thread. And a raise whose answer you
have carried out is closed — `status = 'closed'`, the state past `answered` —
which is neither answering it nor putting it aside, and which is what takes it
off the page and out of `raises`. Leave it as it is if what the answer asked
for is still outstanding.

An answer written on a raise starts a run by itself now, with the raise, its
thread and the answer. If that is the run you are, the turn says so.

A raise is not a way past a step that needs a decision. A step blocked on a
question about the feature it belongs to gets that decision written under the
feature, per **When you reach something you should not decide** in
`building.md`. Nor is it the place for a missing key: that is a setup step,
per the section after it.

Say in the report, by title, anything raised during the run — a question
nobody knows is waiting is the failure this exists to prevent.


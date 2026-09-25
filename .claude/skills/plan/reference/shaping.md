# Shaping an idea

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
   > see **How a decision must be written** in `building.md`.
   >
   > No → it is **fog**. Put it on the feature: `--fog "<what is not yet
   > known, and what would have to be found out>"`. It graduates into steps
   > once somebody can see far enough to write them, and is cleared then.

   Before either test, check the question is worth asking at all. The person
   takes the recommended option almost every time, so most choices are not
   decisions: settle them in the step's `--detail` ("Sorted newest first;
   nothing on the page suggests another order") and the approval covers them.
   Write a decision only when the answer is hard to undo, when the person
   could reasonably want it the other way and nothing already settles it, or
   when it changes what the feature includes. The full bar is under **When
   you reach something you should not decide** in `building.md`. Most
   features need no decisions, and two is a lot.

   Past that bar, the second test is *not* whether you can answer the
   question. A question nobody can answer yet is still a decision if it is
   sharp.

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
   person approves on `/dev/plan`, and only then does the building loop in `building.md`
   apply.

If the idea is already in the plan (`ideas` does not list it), say so and
stop rather than shaping it twice. If the idea is really a bug or a one-line
request, say that it belongs in the notes queue instead, and stop.


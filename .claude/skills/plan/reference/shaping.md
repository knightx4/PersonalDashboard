# Shaping an idea

The second job. An idea on the ideas page is a sentence; the plan needs a
feature with steps, and writing that well takes knowing the code. So when the
user says "shape idea …", or a routine is fired from the *Shape into a plan*
button with an idea in its brief, the job is to write a **proposal** — and
nothing else.

## Until 30 October 2026: only from what the person wrote

For four weeks from 2 October 2026 (docs/CUT-BACK-SPEC.md part 5), a new
feature is shaped only from something the person wrote, meaning a note, an
idea of theirs or an answer, or from a page-view number in `core.page_opens`
(the Usage tab in Dev). An idea a session filed (`ideas.source = 'claude'`,
shown on the ideas page as a suggestion) waits until the hold ends. The end
date is `SESSION_IDEA_HOLD_ENDS` in `lib/plan/hold.ts`, and it is the only
place the date is kept; read it there if this paragraph and the code disagree.

The *Shape into a plan* button already refuses such an idea and says why. A
run that starts some other way, such as "shape idea …" typed in a session,
checks the idea's `source` first. If it is `'claude'` and the date is before
the end date, do not write a proposal: say that the idea was filed by a
session, that it can be shaped from 30 October 2026, and that the person can
file it again in their own words to shape it now. Then stop.

Building approved steps, the inspiration routine and the X post routine are
not held.

1. **Read the idea.** `ideas` lists the ones not yet shaped, with their id
   prefix. The brief a routine was fired with carries the full text.
2. **Read the code it touches.** The module's spec in `docs/`, the routes and
   lib directories it would change, the tests that would need to grow. Decide
   what already exists, what has to be added, and in what order.

   Read the vision too. It says what the workspace is for, in the person's
   words, and the feature has to name the part of it that it serves. A routine
   fired from the ideas page carries it in its brief under **Vision**. Without
   a brief, read it from `module_visions` (the query is in `offline.md`): the
   idea's workspace's vision, or the one stored under `app` when the idea is
   about the app as a whole. A workspace with no vision written does not fall
   back to the app's, the same rule the step briefs follow.
3. **Write the feature.** One top-level step for the idea, in its module:

   ```
   npx tsx scripts/plan.ts add "<the feature>" --module <id> --proposed --idea <prefix> \
     --size l --detail "<what it is, in two or three sentences>" \
     --done-when "<what being finished means, from the user's side>"
   ```

   `--idea` links the idea to the feature, which is what turns the idea's
   button into "in the plan as #n". Do this on the feature, not a step.

   `--proposed` is not optional. A new feature is always the person's to
   approve, and `add` with no `--parent` writes a not-started row unless it
   is told otherwise.

   **The detail opens with the vision line.** Its first line names the part
   of the vision the feature serves, quoting the phrase it serves or staying
   close to it:

   ```
   Vision: "keep every receipt findable in one search", which this serves by …
   ```

   Every feature gets one, and there are two other forms. A feature that
   serves no part of the vision says so and says why it is still worth
   building: `Vision: serves none of it; …`. The person should see that before
   approving, not find it out afterwards. A workspace with no vision written
   gets `Vision: none written for <workspace>.` The line goes in the detail
   and not the done-when, because the done-when is printed as the Destination
   in every step brief under the feature and has to say what finished looks
   like.
4. **Write the steps beneath it**, each `--parent <n>` and each with a
   `--done-when` and a `--size`. Steps under a proposed feature are proposed
   automatically, and approving the feature approves them with it. Three to eight steps is the usual shape; a step sized `l`
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
   apply. That one approval is the last the feature needs: steps a session
   adds beneath it later go in ready to build, except a step that acts
   outside the repository (see **Steps that act outside the repository** in
   `building.md`).

If the idea is already in the plan (`ideas` does not list it), say so and
stop rather than shaping it twice. If the idea is really a bug or a one-line
request, say that it belongs in the notes queue instead, and stop.


# Re-shaping a feature

The third job, and the return trip. Shaping runs once, before anything is
built; from then on the feature is a fixed drawing of a thing that is still
moving. An answer settles a question and changes nothing else, fog written at
shaping is never read again, and a step the answer made pointless goes on
looking live until somebody notices.

So when the user says "re-shape #95", or a routine is fired from the
**Re-shape** button with a re-shape turn, the job is to read the feature
against everything now known and write down what has changed, and nothing
else.

The person approved the feature, and approval stops there: the steps a
re-shape adds beneath it are ready to build without a second approval. Two
things are still proposals. A step that acts outside the repository waits for
the person (**Steps that act outside the repository** in `building.md`), and
so does new work out of a finished feature (step 1), because that is a new
feature and every feature is theirs to approve.

1. **Read the feature.** `show <n>`: its done-when, its fog, its open steps,
   and *Decided so far* — every question settled beneath it. Then read the
   code those answers touch. An answer changes what is buildable only if you
   know what is there.

   **A feature that is already `done` or `dropped` takes no new rows.** Its
   status says it is finished, and a new row appearing inside it reads as the
   feature having re-opened itself. Re-shaping one is still legitimate — an
   answer can land under it long after it closed — but everything the re-shape
   turns up there is *new work*, so it goes at the top level:
   `add "…" --proposed` with no `--parent`, a detail that opens by saying it
   came out of `#<n>`, and the steps and questions under **that**. Pass
   `--proposed` every time: `add` without a parent writes a not-started row,
   and a new feature waits for the person like any other. The steps under it
   are then proposed without the flag, because the feature above them is.
   The one write a re-shape may still make to the closed feature is
   `fog <n> --clear`, and only once the new feature that dispels the fog
   exists.
2. **Graduate the fog.** If an answer, or the code, has made the fog
   specifiable, write those steps now: `add "…" --parent <n> --done-when "…"
   --size s|m|l --from <the decision>`, and clear the patch in the same breath
   with `fog <n> --clear`. Under an approved feature they go in ready to build;
   a step that acts outside the repository (sending an email or a message,
   submitting, buying, changing records elsewhere such as a Vercel setting or
   DNS) takes `--proposed` and waits for the person, as **Steps that act
   outside the repository** in `building.md` says. **`--from` on every row a re-shape
   writes**: it stamps the step with the answer that produced it, and a
   step appearing under a feature somebody approved last week is confusing
   until it says why it is there. The gist is read off the
   decision's own answer, so it cannot be paraphrased into something nobody
   said. Fog that is *still* fog stays exactly as it is — a patch
   rewritten into something vaguer is worse than one left alone. If part of it
   has cleared and part has not, `fog <n> --note "…"` with what is left.
3. **Say what an answer invalidated.** A step an answer made pointless is
   `drop <n> --note "…"`, naming the answer that did it and why: "#63's answer
   settles this on the server, so the client half is not needed." A re-shape
   may drop, and must always say why. If you are not sure the step is dead,
   it is not: say so in the report and leave it alone.
4. **Write the new questions.** An answer usually surfaces the next question.
   Most of them are yours to settle: if you would recommend an answer and the
   person would very likely take it, write the choice into the step it
   affects and move on. The bar for asking is under **When you reach
   something you should not decide** in `building.md`. A question that clears
   it and can be phrased sharply is a decision: `add "…?" --parent <n>
   --kind decision --from <the decision it came out of> --detail "<the real
   options, lettered from A, one per line, each with its cost; then your
   recommendation>"`. If it cannot, it is fog on the feature — but only if the
   feature is unfinished without it. A question the feature can ship without is
   a follow-on: file it with `idea "…"` and leave the feature alone. Same two
   tests as shaping, the same one patch of fog, and the same three parts to a
   decision — see **How a decision must be written**.
5. **Stop.** Do not `approve`, do not `answer` a decision, do not `start` or
   build anything, and do not add again what the feature already holds —
   read the existing steps first, including ones an earlier re-shape added,
   and everything under *Already dismissed*, which is what the person has
   turned down and is not to be written back in any form.
   Report what you added (saying which went in ready and which as
   proposals), what you dropped and why, what fog you cleared, and anything
   you noticed and deliberately left alone, all **by number and title**.

The contract this rests on: the person approves a feature once, and the plan
beneath it adapts without asking again. What makes that safe is that every
row a re-shape adds says where it came from. `--from` names the answer, the
session stamp names the run, and `/dev/plan` marks an open step a session
added with a one-press drop, so the person can undo any of them without
reading the whole feature again. What still waits for an approve is what the
original approval did not cover: a new feature, and a step that acts outside
the repository.


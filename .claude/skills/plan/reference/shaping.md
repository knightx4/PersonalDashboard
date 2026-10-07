# Shaping an idea

The second job. An idea on the ideas page is a sentence; the plan needs a
feature with steps, and writing that well takes knowing the code. So when the
user says "shape idea …", or a routine is fired from the *Shape into a plan*
button with an idea in its brief, the job is to write a **proposal** — and
nothing else.

A run started by approving a spec change is the one exception: its work
goes in approved, and its procedure is the last section of this file.

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

   **Shape for building side by side.** A feature run builds up to three
   ready steps at once (`SKILL.md`, Building, step 3), and every step pays
   the same fixed cost of a brief, design check, gate and merge, about half
   an hour whatever its size. So:

   - Make a step wait on another only when it reads code or a table the
     other one creates. Living on the same page is not a reason; two steps
     on one page that do not touch the same component can be built apart.
   - Fold a small step into its neighbour when both change the same screen.
     A progress block in a page's properties column belongs in the step that
     builds the column, not in an `s` step of its own after it.
   - Put the shared piece first and keep it small, so the steps that use it
     are ready sooner. A chain of four steps each waiting on the last is a
     day of building; four steps waiting on one is an hour and a half.

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

   **A step that adds or changes a screen names its pattern.** The patterns
   are listed on `/dev/ui` under "Page patterns" (Part 4 of
   `docs/UI-QUALITY-SPEC.md`), by the names in `lib/plan/patterns.ts`:
   `list and detail`, `deck`, `thread` and `tabbed detail`. End the step's `--detail` with
   the name on a line of its own:

   ```
   Pattern: list and detail
   ```

   The step's brief prints that pattern's rule, and the building session
   gives the rule to the design critic, which judges the screen against it.
   A step that changes no screen has no pattern line.

   **A screen that fits none of them is a decision for the person.** Every
   later screen of that kind would follow it, so do not invent the layout in
   a step's detail. Write the decision under the feature and make the step
   `depends` on it:

   ```
   npx tsx scripts/plan.ts add "Which layout for <the screen>?" --parent <n> \
     --kind decision --detail "A — Use <the closest pattern>. <what it would not show well>.
   B — Make <the new pattern> a pattern of its own. <its rule in one or two sentences, and its component and gallery entry as part of this feature>.
   Recommend <A or B>: <why>."
   ```

   Until it is answered, the step's detail says `Pattern: none fits, see
   #<the decision>`. The brief reads any name that is not one of the three
   as waiting on the person.

   **A feature whose screens have a moment ends with a moments step.** The
   moments are the catalogue in `app/dev/ui/moments.ts`, listed on `/dev/ui`
   (Part 8 of `docs/UI-QUALITY-SPEC.md`). When the feature builds or changes
   a screen that a catalogue moment plays on, or adds a moment of its own,
   its last step is:

   ```
   npx tsx scripts/plan.ts add "Build its moments and pass the craft check" --parent <n> \
     --size s --detail "<each moment by its catalogue name, and the screen it plays on>" \
     --done-when "<the moments, by name> play as the catalogue describes, with their reduced-motion versions, and the craft check passes on each one's frame strip."
   ```

   Make it `depends` on the steps that build those screens. A feature is not
   done while a step under it is open (the plan's health check flags one
   closed over open steps), so the feature waits on its moments too. When the catalogue already gives a moment to an open step
   (its `state.step`), that step builds it: name it in the detail and
   `depends` on that step rather than building the moment twice. Leave the
   moments step out when no screen the feature touches has a moment.

   The craft check is the critic's second checklist (#1566), read against the
   strip `npm run record` writes to `.preview-shots/strips/`: a press shows a
   response in the first frame after it, motion follows the finger and ends
   settled with no jump, the catalogue moment is there, and the wording names
   real counts and things. Until that critic is on main, the session building
   the step records the strip, checks the four points against it itself, and
   says so in the note it closes with.

   **A fourth moment in a workspace is a decision for the person.** Each
   workspace has at most three, so they stay noticeable (R8, held by
   `tests/dev-ui-moments.test.ts`). Count the workspace's moments in the
   catalogue first. If the feature would add a fourth, do not put it in the
   catalogue or in a step's detail. Write a decision under the feature and
   make the moments step `depends` on it:

   ```
   npx tsx scripts/plan.ts add "Should Jobs trade a moment for <the new one>?" --parent <n> \
     --kind decision --detail "A — Keep the three Jobs has. <the new one> becomes a plain response with no moment.
   B — Replace <one of the three, by name> with <the new one>. <what the person stops seeing>.
   Recommend <A or B>: <why>."
   ```

   The same holds outside shaping: a session building or re-shaping that
   finds it wants a fourth moment writes this decision and blocks on it
   (`building.md`, **When you reach something you should not decide**).
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


## From an approved spec change

A run the Approve button on `/dev/specs` starts (plan #1509,
`docs/SPEC-LAYER-SPEC.md` Part 3). Its brief carries the change's id, title,
why, the spec's file and the diff. The person has read the diff and approved
it, so this run writes it into the spec and shapes the work, and what it
shapes goes in approved. The hold above does not apply: an approved change is
something the person decided.

1. **Re-read the change.** `select status, spec, title, diff from spec_changes
   where id = '<id>' and user_id = '<user>'`. Stop unless the status is
   `approved`. `applied` means an earlier run already wrote it in;
   `proposed` means it was put back.
2. **Write it into the spec.** Branch from an up-to-date `origin/main`, save
   the row's diff to a file in your scratchpad, and run
   `npx tsx scripts/apply-spec-diff.ts docs/<file> <diff file>`. The script
   places the diff by its lines rather than its line numbers, writes the
   spec, and prints the diff as placed. Never edit the diff or the spec by
   hand to make it fit: the person approved those lines. If the script says
   *Not applied*, the spec has moved under the change. Put the change back to
   proposed (`update spec_changes set status = 'proposed', decided_at = null
   where id = '<id>' and user_id = '<user>' and status = 'approved'`), write a
   comment on its thread (`core.add_thread_turn` under `public.spec_changes:<id>`, author `claude`)
   saying which lines are gone and that `@dash` can redraft it, and stop.

   For a spec the change creates, the file does not exist yet and the script
   creates it. Add its entry to `SPECS` in `lib/specs/registry.ts` in the
   same commit, with a one-sentence blurb.
3. **Put it on main.** Commit the spec on its own, subject `Write "<change
   title>" into the <spec title> spec`, with the change's id in the body.
   Then `git fetch origin`, merge `origin/main`, `npm run gate`, and merge to
   main and push as in step 4 of the Building section in `SKILL.md`. If the
   gate fails because of the change itself, such as a spec rule check, put
   the change back to proposed as in step 2 with the gate's reason in the
   comment, and stop.
4. **Mark it applied**, in one statement, with the sha of the commit that
   changed the spec:

   ```sql
   update spec_changes
   set status = 'applied', applied_at = now(), commit_sha = '<sha>'
   where id = '<id>' and user_id = '<user>' and status = 'approved';
   ```

   The table requires `applied_at` exactly when the status is `applied`, so
   the three go together. The change then leaves `/dev/specs`.
5. **Decide what the change asks for.** Read the spec around the diff and the
   code it describes, then sort the change into one of three:

   - **Nothing to build.** The change brings the spec up to what the code
     already does, often from a `drifted` finding whose proposal was
     `change_spec`, or it only rewords. Shape nothing and say so in the
     report.
   - **An addition.** It adds behaviour without replacing how something
     already works. Shape it as below.
   - **A replacement.** It changes how something that exists works, which
     Part 4 of the spec builds as an overhaul. Shape it as below.

6. **Shape an addition** with steps 2 to 5 of "Shaping an idea", with these
   differences:

   - The feature is written `not_started`, not proposed, and so are the
     steps beneath it: approving the change approved them. Each carries the
     session stamp on its own line of `comment` (`Added by session cse_… on
     <date>.`, as `offline.md` writes it), so the page marks it as written
     for the person and offers the drop.
   - After the vision line, the detail's second sentence names the change:
     `From the spec change "<title>", approved on <date>.`
   - A step that acts outside the repository is still proposed, and a
     decision is still the person's to answer. Neither is approved by the
     change.
   - The module is the workspace the work changes. The spec's own `module` in
     the registry is a hint, and `null` there usually means `dev`.
   - Link the change to the feature: `update spec_changes set plan_item_id =
     '<feature id>' where id = '<id>' and user_id = '<user>'`. One change
     should make one feature. If it really makes two, link the first and name
     both in the report.

7. **Shape a replacement** as an approved overhaul held at its design
   (plan #1527). Decision #1508 approved a replacement with the change except
   for one stop: nothing of its phases is written or built until the person
   has tried the design on one workspace and accepted it. So the overhaul
   starts with three rows and no more, written by one script:

   ```
   npx tsx scripts/overhaul-opening.ts --user <user> --module <m> \
     --spec docs/<file> --change <id> --workspace "<the workspace to move first>" \
     --title "<the overhaul>" --detail "<vision line, the change sentence, what it replaces>" \
     --done-when "<the overhaul's done-when>"
   ```

   It prints the statements that write the feature (`track = 'overhaul'`,
   not started, stamped with your session), the design session, the
   person's try-it step (a setup step of theirs, waiting on the design), and
   the step that writes the phases, which waits on the try-it step and the
   design. It also links the change to the feature. Pass the statements to
   the connector in order, or add `--write` where `DATABASE_URL` is set. Leave
   `--workspace` out when the spec does not name one, and the design session
   takes the smallest workspace the change touches.

   The detail follows step 6: the vision line, then `From the spec change
   "<title>", approved on <date>.`, then what the change replaces. Write
   nothing else under the overhaul: its phases come from the Contract the
   design session writes, by the third row, after the person accepts the
   design. `overhaul.md` is how the overhaul's own run works the three.
8. **Report** the commit on main, the change marked applied, and every row
   you wrote by number and title, or which of steps 1 to 3 stopped the run
   and why.

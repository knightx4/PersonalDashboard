# Building a screen

Read this when your step changes a screen: the brief has a `## Gallery
surfaces` section, or the change touches a `.tsx` file under `app/` or
`components/` that a person sees. It is one part of step 5 of the loop in
`building.md`, which still says how to claim, verify, commit and report. A
step that changes no screen never reads this file.

A step that adds or changes a screen draws it in the gallery, photographs it
and has a separate critic pass the pictures before the screen is wired to real
data (`docs/UI-QUALITY-SPEC.md`, Parts 1 to 3). The first version of a screen
used to be designed by reading code, and most of the person's notes were about
what that missed on a phone.

**Which surfaces.** The brief's `## Gallery surfaces` section lists them, as
`- <id>: /preview?s=<id>, for <routes>`. Working offline there is no brief
from the CLI, so read them yourself: `surfacesInText` and `surfacesForFiles`
in `lib/preview/routes.ts` give the surfaces a step's words and changed files
name. A step that changes a page with no surface adds one, and adds its routes
to `SURFACE_ROUTES` in the same file; `tests/preview-routes.test.ts` fails on
a surface with no routes. A step that changes no surface skips this section.

**Hidden parts.** A screen has parts a person sees only after doing
something: hover controls, popovers, drawers, empty and loading states, and
comment indicators. The hidden-parts rule in `docs/UI-QUALITY-SPEC.md` makes
them part of the screen. When the brief or the step's detail lists any, build
every one with the screen, not the default layout alone, and give each its
own gallery surface (an entry in `app/preview/surfaces.tsx` that draws the
part open or showing, with a route in `SURFACE_ROUTES`), named
`<id>-<part>`. A hover control is drawn with the hover held, a drawer or
popover open, an empty state with an empty fixture, a loading state mid-load,
and a comment indicator on a row that has a comment. Photograph each with the
rest of the loop below, so every listed part has its four shots and its own
recorded round. A part you cannot draw is not skipped silently: say which
and why in the close note. Send the critic the list of hidden parts the step
names, or "none" when it names none, in the prompt (4 below). A screen that
shows only its default state, with a listed part missing, comes back as a
fix and is not wired until every part is drawn and passed.

**References.** A reference is a design the person prefers for a screen
(`docs/UI-QUALITY-SPEC.md`, Part 2 and R18), kept by surface id in
`lib/preview/references.ts`, so every later step on that surface is judged
against it too. The brief prints a `## Reference` section when the step's
detail has a `Reference:` line or one of its surfaces already has a reference
registered; working offline, read the line and `REFERENCES` yourself.

- **Register one the step names**, before round 1. Add an entry under the
  surface it is for, with `pictures`, `link`, `why` (what the person likes
  about it, in a sentence, from the step or their note) and `from` (this
  step's outline). Save its pictures under `docs/references/<surface>/` and
  list them. A mockup made in a chat (a `claude.ai/artifact` link) also
  saves its HTML there, read with the Artifact tool, as the entry's
  `source`, so you and the critic take its sizes, colours and spacing from
  the page rather than from pixels. Build from the app's own components and
  tokens all the same: the source is what to match, never code to paste. The
  gate fails a chat mockup registered without its source. A link with no pictures is photographed the first time: open it
  at 390 and 1280 wide, as the gallery shots are, save the shots there, and
  list them, so every later round sees the same design whatever the page
  shows by then. A step that names a reference without saying which surface
  it is for registers it under the surface the step changes; with several,
  the one the step's words name. `tests/preview-routes.test.ts` fails on a
  reference whose surface is not in the gallery or whose pictures are missing.
- **Send a registered reference to the critic on every round** on its
  surface, in this step and every later one, as the prompt's `reference`
  (4 below). A surface with none is sent "none", and its verdict has no `layout`.
- **Check the layout before wiring (plan #2966.5).** Round 1 on a surface
  with a reference asks the critic one more question than the laws: does the
  layout match the reference, meaning the panes, where the list and the
  content sit, and what each row holds. The answer comes back as `layout`
  (`{ "answer": "...", "ok": true|false }`) in the verdict, and the recorder
  refuses a verdict without it on a surface that has a reference. A no fails
  the round whatever the laws say, and the screen is not wired to real data
  until a round answers yes: moving panes is cheap on fixtures and costly
  after wiring. `ui-guard` keeps refusing the step until a later round on the
  surface answers yes. Settling does not clear it; only a round that answers
  yes or the person's answer does. (On 4 November 2026 the People tab passed
  review as a full-width list while its mockup was a two-pane messenger.)
- **Never scope the critic away from the reference.** Do not ask it to leave
  a difference unraised because a shared component draws it or a later step
  will. A shared component that makes the screen differ from its reference is
  this step's to change. A difference no law requires and that you cannot
  close goes in the close note by name, as an open difference from the
  reference, where the person can overrule it.

**Stage 0, once the screens are drawn and before the first critic round:** run
`npm run ui-guard -- <step> --compare` (**Compare with main first**, below).
It settles every surface with no visible change from main, and prints how many
it settled and how many go on. The loop that follows is for those that go on.

**The loop, for each surface:**

1. **Shoot main first.** Before changing anything, photograph the surface as
   main has it, for the critic to compare against. Take it from a worktree of
   `origin/main` (`git worktree add <dir> origin/main`, with a link to this
   checkout's `node_modules`), shooting it as in 3 below, so the shots land
   in that worktree's `.preview-shots/`. Stop its preview server before
   starting your own, since both use port 3400. A new surface has no before
   shots; the critic is told "none". Copy the worktree's
   `.preview-shots/<id>--*.png` into this checkout's `.preview-shots/before/`:
   the recorder uploads them beside each round as `before-<shot>`, and the
   step's plan row shows them next to the after (plan #1541). Turbopack
   refuses a `node_modules` symlink that points outside the worktree, so
   give the worktree a hard-linked copy (`cp -al`) instead.
2. **Draw it in the gallery.** Add or update the surface's entry in
   `app/preview/surfaces.tsx` with typed fixtures and the real components.
   Fixtures as long and as empty as real data gets: the longest name, the
   empty list.
3. **Photograph it.** Build and serve the preview, then shoot the one
   surface:

   ```
   export NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
   export NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder-anon-key
   npm run preview &          # UI_PREVIEW build and start on port 3400
   npm run shoot -- <id>      # one surface per run
   ```

   When the session that sent you named a port (it does when it is building
   several steps at once, each in its own worktree), export `PREVIEW_PORT`
   to it before both commands; `preview` and `shoot` read it, and two
   builders on 3400 would photograph each other's screens.

   Without the two placeholders the preview pages answer 500. The shots are
   `.preview-shots/<id>--{phone,laptop}-{light,dark}.png`: 390 and 1280
   pixels, light and dark. Open them yourself before sending them on.
   A phone page taller than the screen with a row fixed to its foot also
   gets `<id>--phone-{light,dark}-end.png`, at the phone's own height and
   scrolled to the end, since the full-page shot draws that row partway down
   the content. Send those to the critic as well.

   A surface whose gallery entry declares an `interaction` is recorded too,
   with the same server running: `npm run record -- <id>` writes
   `.preview-shots/strips/<id>--phone-light.png` and its `.json`, a second
   of frames 50ms apart. The critic judges craft from it.
4. **Hand them to the critic.** The `ui-critic` agent
   (`.claude/agents/ui-critic.md`) judges the pictures and nothing else. Run
   it as the subagent `ui-critic`, or, where you cannot start a subagent,
   headless with the prompt on stdin:

   ```
   echo "<prompt>" | claude -p --agent ui-critic --allowedTools "Read,Glob,Grep"
   ```

   The prompt names the surface id, the round (1, 2 or 3), the four after
   shots, the before shots or "none", the strip and its JSON or "none", the
   moment from `app/dev/ui/moments.ts` the surface plays (its name and
   `sees` line) or "none", the reference registered for the surface in
   `lib/preview/references.ts` (its picture paths, link and `why`, as
   `referenceForCritic` prints it) or "none", the hidden parts the step lists
(each with the surface that draws it) or "none", the step's done-when, the page pattern, and on
   rounds 2 and 3 the fixes from the round before. The
   pattern is the name and rule under the brief's `## Pattern` section.
   Working offline, take the name from the `Pattern:` line of the step's
   detail and its rule from `lib/plan/patterns.ts`. A step that names none
   uses the pattern that fits and says which in its close note. One whose
   screen fits none blocks on a decision for the person (`shaping.md`).
   The prompt also names the preferences the person has removed from
   `/dev/ui`, which the critic must not cite: `select taste_id from
   ui_taste_removals where user_id = '…'`, or "none". It answers with a paragraph and a fenced `json` verdict:
   `verdict` is `pass` or `fix`, and each fix names the shot, where, the
   problem, what it breaks (`law <n>`, `taste:<id>`, `pattern`, `done-when`,
   `regression`, `question:eye` or `reference`) and the change. A screen
   that keeps every law but reads worse than its reference fails with a
   `reference` fix naming what the reference does better; where the
   reference breaks a law, the law wins. Every verdict also
   answers three questions under `questions`, each with an `answer` and an
   `ok`: `eye`, where the eye goes first and whether that is what the screen
   is for; `competition`, whether anything such as a label, outline or
   heading competes with the data; and `lines`, whether the lines are
   lighter than the text (UI-QUALITY-SPEC Part 2, R19). A screen with no
   clear answer to the first fails. The prompt asks for all three; a
   verdict that comes back without them goes back to the critic, since the
   recorder refuses it.
5. **Record the round** (below), whatever the verdict.
6. **On `fix`, make every change it asks for**, shoot again and start the next
   round. Most surfaces fail round 1. A fix you think is wrong is still the
   critic's call: make it, or say in the next prompt why it cannot be made,
   and let the critic rule on that.
7. **On `pass`, wire it.** Connect the screen to real data. If wiring it
   changes the components the gallery draws, shoot again and send the new
   shots to the critic as the next round.

**The builder never writes the verdict.** You copy the critic's `json` block
as it came back. You do not edit it, summarise it into a pass, or judge the
pictures yourself in its place.

**Three rounds, then settle it yourself.** If round 3 comes back `fix`, stop
the loop: no fourth round. Design checks are not questions for the person.
They said so on 12 October 2026, after a week of "accept it as it is"
blocks, and that answer replaces decision #1535's A. The one exception, a
fix that cites the mockup, the done-when or a regression, is the next
paragraph. For every other fix:

1. Record round 3 like any other (below).
2. Make any of the open fixes you can make cheaply, without another round.
3. Run `npm run ui-stop -- <step>`. It prints the last fixes in full and the
   settle command: `npm run ui-guard -- <step> --settle "<why>"`. Run it, or
   the statement it prints through the connector. It writes an `accepted`
   round for each surface still waiting, with notes opening "Settled by
   Dash", so the record keeps who let the screen through.
4. Merge and close the step as usual. The close note names each surface
   settled and the fixes still open, in a line, so the person can overrule
   it from the step's row.

**A screen that misses its mockup goes to the person (plan #2966.4).** Three
kinds of fix are never settled: one whose `breaks` is `reference` (it reads
worse than its mockup), `done-when` (it does not do what the step says) or
`regression` (it is worse than it was). On 5 November 2026 the person agreed
that a screen still failing one of these after three rounds comes to them,
with the shot beside the mockup. Their rule of 12 October 2026 still holds
for every other kind of fix: a law, a preference, the pattern, a craft check
or a spec rule left open after round 3 is settled as above, and never put to
them.

`--settle` and `--compare` leave such a surface out, whatever round it is on,
and print why. The close guard and `land` hold it until a later round passes
or the person answers; a settle written past it does not clear it. Before
round 3, fix it and run the next round. After round 3:

1. Shoot the surface again, so `.preview-shots/<surface>--laptop-light.png`
   is the screen as it stands.
2. Run `npm run ui-guard -- <step> --ask` (`<feature> --feature --ask` in the
   land review). For each held surface it writes
   `.preview-shots/asks/<step>--<surface>.html`: option A is the shot as
   built, and option B is the reference picture from `docs/references/<surface>/`
   (main's shot from `.preview-shots/before/` for a regression with no
   reference; the critic's findings alone for a done-when with neither),
   with the held fixes listed under it. It prints the two commands below
   with the question, the options and the page's `/preview?s=<id>` link
   filled in.
3. Write the decision under the feature:
   `npx tsx scripts/plan.ts add "<question>" --parent <feature> --kind decision --detail "<options>" --mockup .preview-shots/asks/<step>--<surface>.html`.
   `--mockup` takes one HTML file and photographs each `data-option`
   element at 390 and 1280, so the shot and the mockup show side by side
   beside the options on the Inbox and on the plan page. Merge the gallery
   drawing to main first, so the `/preview` link in the detail opens it.
4. Block on it: `npx tsx scripts/plan.ts block <step> --on <the decision> --ask "<the ask it printed>"`.
   In the land review, block each step `land` names as held by that
   surface. The ask names the page and its options, never the critic or a
   design check, which `block` refuses (`lib/plan/block-ask.ts`).
5. When the person answers A, keep it as built: `npm run ui-guard -- <step>
   --accept` (or `<feature> --feature --accept`). It takes the answer to a
   question with pictures that the step waits on, or that sits under the
   feature, answered after the surface's last round, and writes an
   `accepted` round quoting it. When they answer B, make the change and run
   the critic again; the next round has to pass.

**Compare with main first (plan #2966.2).** Before any round goes to the
critic, run `npm run ui-guard -- <step> --compare`. It is the first stage: a
screen that looks the same as on main is signed off by comparison, and only a
screen whose shots differ is sent to the critic. It covers every surface the
step's files serve that has not passed: the ones the step lists as its own
(its title, detail or done-when links as `/preview?s=<id>`, or the critic has
judged them) and the ones a shared file reaches (a change to a shared row or
folder can name dozens of screens nobody meant to change). It shoots each on
this checkout and on origin/main, settles those whose four shots match with
the reason `SAME_AS_MAIN_REASON`, and prints how many it settled and how many
go to the critic, then lists those, with the time each part took. A surface
main does not have is new, and goes to the critic from round 1. It builds what
is not running: the branch's preview on `PREVIEW_PORT` (a running one is used
only when built after the step's last change) and main's in a worktree under
the temp folder on `PREVIEW_PORT` + 1000, kept for the next run. `--workers
<n>` sets how many shooters a side, three by default. Do not block on these
surfaces.

`--settle` lets a surface through that the critic has not passed only when it looks the same as on main
(plan #2215.4). For every surface still waiting that the critic has not
judged through three rounds, it compares the four shots in `.preview-shots/`
with main's in `.preview-shots/before/` pixel by pixel, and refuses the whole
settle, writing and printing nothing, when any shot is missing, has changed
size, or differs in more than one pixel in ten thousand. So shoot those
surfaces on main and on the branch first (`npm run shoot` with no id shoots
every surface, in each checkout). A surface the refusal names has changed:
it goes to the critic like any other, from round 1. Findings the critic makes on a surface the step did not cause are not
this step's: file them as a ready step if they are worth doing, and close
this one.

A shared component that has a surface drawing it in every state belongs on
`COMPONENT_SURFACES` in `lib/preview/routes.ts`, so the guard stops at that
surface rather than every page under it. Every file in `components/ui` is
already there: a change to Button or Card is checked once, on `ui-kit`
(`app/preview/ui-kit-surface.tsx`), and a new primitive is drawn there too.

`block` refuses an ask that puts a design check to the person
(`lib/plan/block-ask.ts`). Older steps blocked on one before the change: when
the person answers, read any answer that names nothing to change as an accept
(`npm run ui-guard -- <outline> --accept`), merge the branch the history names and
close the step. When the answer says what to change, the builder gets three
fresh rounds against their words, numbered on from 4.

**Recording a round.** Every round goes on record, passed or failed, before
you make its fixes:

1. Save the critic's `json` block, unchanged, as
   `.preview-shots/checks/<step>--<surface>--r<round>.json`. That folder is
   gitignored.
2. Run the recorder:

   ```
   npm run ui-check -- <step> <surface> <round>
   ```

   It checks the file is the critic's shape and is for that surface and
   round, refusing one that leaves out any of the three questions or passes
   a screen whose `eye` answer is not `ok`, keeps a copy of the four shots beside it as
   `<step>--<surface>--r<round>--<shot>.png` (the next shoot overwrites the
   originals), and writes one row to `public.ui_checks`: step, surface,
   round, verdict, the fixes and the `earlier` list as the critic wrote them,
   its notes, the three answers in `questions`, and the shots' paths in the private `ui-shots` bucket. A round
   recorded twice is replaced, not duplicated.

What the recorder can reach depends on the session:

- With `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, it uploads
  the shots to `ui-shots/<user id>/<step>/<surface>/r<round>/<shot>.png`,
  which only the account can read, and writes the row.
- With only `DATABASE_URL`, it writes the row with no shots.
- With neither, as on the web, it prints the insert. Send that through
  `npx tsx scripts/sql.ts --file` as it is printed. The critic's text is in base64
  inside it, so no apostrophe reaches the connector. The row is written with
  no shots, and the shots stay in `.preview-shots/checks/` for the report.
  Storage uploads do not go through SQL, so the connector cannot put them in
  the bucket.

A round whose recorder you could not run at all is not recorded: say so in
the report rather than leaving it out.

**The close checks the rounds.** `done` refuses a step whose commits change a
`.tsx` file under `app/` or `components/` while the latest recorded round of
any surface those files serve is not a `pass`, and names each such surface
(plan #1534, `lib/plan/ui-check-guard.ts`). `npm run ui-guard -- <outline>` runs
the same check from your branch, and prints the SQL for the connector where
there is no `DATABASE_URL`. Run it before you report a screen step: a
surface it names is a round still to run or record. A step built in a batch
is closed by `land` instead, from the feature's land review below.

## The land review: each screen once, at the feature's head

A feature in a batch is reviewed once, when it lands (plan #2966.3). The
rounds a builder records on its own step are its working checks: they show it
the screen is right before it reports, and they no longer close anything.
What closes the feature's screen steps is one set of rounds recorded under the
feature's number, taken on the feature branch head once every step is built,
for every surface the branch reaches. A page two steps both changed is judged
once, in the state that goes to main.

`land` reads those rounds (`lib/plan/ui-feature-review.ts`). A round counts
only when it was taken at a commit that holds every built step's commit, so a
round from before the last step merged does not. A step that changed no screen
closes on its commit alone; a screen step closes once every surface it
reaches has passed in the feature's rounds; one that has not stays open, and
`land` names the surfaces holding it.

The session landing the feature runs the review on the branch head after the
gate and before the merge to main, since after the merge origin/main already
has the feature and every surface would compare the same:

1. `npm run ui-guard -- <feature> --feature --compare`. It shoots every
   surface the branch serves that has not passed at the head, on the head and
   on origin/main, and settles those that look the same, recording the head
   on each settled round.
2. `npm run ui-guard -- <feature> --feature --sheets`. It groups what is left
   by page (the first route in `SURFACE_ROUTES`) and prints, for each page,
   the main state's four shots, a strip of the page's other states, the round
   to run and the command that records it. Shoot any state it lists as not
   shot yet, then run it again.
3. **One critic round a page.** The critic gets the main state's four shots
   and the strip (`.preview-shots/sheets/<main>--states.png`, each other state
   at phone width in the light theme) and judges the page as a whole: a fix
   on a state names it in `where`. Everything else in the prompt is as in the
   loop above, with the feature's done-when in place of a step's.
4. **Record it for the whole page:** `npm run ui-check -- <feature> <main>
   <round> --commit <head> --states <id>,<id>`. The one verdict is written for
   the main state and for each state, each with its own shots kept beside it.
5. On `fix`, make the changes on the branch, commit them against the step that
   drew the screen, and run the next round at the new head. A round taken
   before a commit that changed a screen file the branch changed no longer
   counts, so `--feature` alone tells you what is still to judge.
6. Three rounds, then settle as above: `npm run ui-guard -- <feature> --feature
   --settle "<why>"`. A layout the critic said differs from its reference is
   never settled (plan #2966.5), and nor is a surface whose last round cites
   the mockup, the done-when or a regression: that one goes to the person as
   **A screen that misses its mockup goes to the person** says, with
   `--feature --ask`.

`--feature --compare` refuses once the head is already on origin/main (or
`--base`): after the merge every surface looks the same as main and would be
settled without being looked at. Run it on the branch head before the merge.

`npm run ui-guard -- <feature> --feature` with no other flag says whether the
feature may land, and exits 1 naming each surface not yet passed at the head.

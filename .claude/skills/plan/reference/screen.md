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
  (4 below). A surface with none is sent "none".
- **Never scope the critic away from the reference.** Do not ask it to leave
  a difference unraised because a shared component draws it or a later step
  will. A shared component that makes the screen differ from its reference is
  this step's to change. A difference no law requires and that you cannot
  close goes in the close note by name, as an open difference from the
  reference, where the person can overrule it.

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
blocks, and that answer replaces decision #1535's A. So:

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

**Surfaces a shared file reaches.** The close guard lists every surface a
changed file serves, so a change to a shared row or folder can name dozens
of screens nobody sent to the critic. Send the surfaces the step meant to
change to the critic. Settle the rest with the same command, naming in the
reason that the step did not set out to change them, and do not block on
them.

The settle lets one of those through only when it looks the same as on main
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
surface it names is a round still to run or record.

# Building one plan step

You have been given one step from the build plan by number. Build it, verify
it, commit it, close it, and report. You are not working the rest of the
feature — the session that sent you is, and it will send the next step once
you are done.

**The rule that matters: the plan must always tell the truth.** Never leave a
step in a state that misrepresents reality. If it cannot be finished, it is
`blocked` with the specific question — not left `in_progress` to look busy,
and not marked `done` because you are running out of room.

## The commands you need

`scripts/plan.ts` needs `DATABASE_URL` (service role) in the environment. If
it is missing, read `offline.md` in this directory instead of guessing.

```
npx tsx scripts/plan.ts show <n>               # the brief: destination, decisions, done-when, waits
npx tsx scripts/plan.ts start <n>              # claim it (in_progress); refuses a decision
npx tsx scripts/plan.ts done <n> --note "…"    # close it; records HEAD commit
npx tsx scripts/plan.ts block <n> --ask "…" [--on-steps] [--note "…"]
                                               # cannot proceed; the ask is the one sentence
                                               # saying what it needs, rewritten each time.
                                               # --on-steps: waiting on the steps it names, so
                                               # it clears itself when they close. Without it
                                               # the block waits for the person.
npx tsx scripts/plan.ts needs "<what to set>" --for <n> [--detail "…"]
                                               # something only the person can supply: writes a
                                               # setup step of theirs under the same feature and
                                               # makes <n> wait on it
npx tsx scripts/plan.ts reopen <n>             # put it back to not started
npx tsx scripts/plan.ts drop <n> --note "…"    # will not do; say why
npx tsx scripts/plan.ts add "title" --parent <n> [--done-when "…"] [--fog "…"]
                                               [--proposed] [--size s|m|l] [--from <n>]
                                               # under an approved feature the step is
                                               # ready to build; --proposed only for a
                                               # step that acts outside the repository
npx tsx scripts/plan.ts add "the question?" --parent <n> --kind decision --detail "…"
npx tsx scripts/plan.ts depends <n> --on <m>   # n cannot start until m is done
npx tsx scripts/plan.ts fog <n> --note "…"     # what cannot be seen yet; --clear once it can
npx tsx scripts/plan.ts idea "…" [--module <id>] [--from <n>]
                                               # one close to an idea already filed is
                                               # refused; two an hour is the most you may file
npx tsx scripts/plan.ts raise "…" --ask "…" --consequence "<action>: <what>"
```

Steps are named by number — the `#12` on the page. Numbers are never reused.

## The loop

1. **Claim it first.** `start <n>`, before reading anything. `start` refuses a
   proposal and refuses a decision, so claiming first is also the cheapest way
   to find out the step is not yours.
2. **Read the brief.** `show <n>`. Read the "Done when" section twice; it is
   what the work is checked against. If there is none, write one from the
   detail and the parent's context before starting, and say so in the note.
   Where the step's workspace has a vision written, the brief opens with it
   under **Vision** (the app's, for a step with no workspace): what the
   workspace is for, and the thing a change that meets its done-when can
   still miss. The brief also carries **Destination** — the feature's own done-when — and
   **Decided so far**, every question already settled beneath that feature.
   Build against those: they are the answers you would otherwise ask for
   again.
3. **Check what it waits on.** A brief that says "waits on #9 (still open)" is
   not ready, whatever you were told. Put it back — `reopen <n>` — and say so
   in your report.
4. **Break it down if it is large.** A step sized `l`, or one whose brief
   describes more than one sitting of work, gets sub-steps first
   (`add "…" --parent <n>`), each with its own done-when. Build the first, and
   report the rest so the next one can be sent. The plan is more useful with
   the breakdown in it than with the breakdown in your head.
5. **Make the change.** The smallest change that meets the done-when. Follow
   the repo's rules (`README.md` "Rules", the module's spec in `docs/`). Do not
   fold unrelated cleanup into a step's commit.

   **A step that changes a screen starts in the gallery.** When the brief has a
   `## Gallery surfaces` section, or the change touches a `.tsx` file under
   `app/` or `components/` that a person sees, follow **Building a screen**
   below: draw it with fixtures, photograph it, have the critic pass it, and
   only then wire it to real data.

   **Read the part you need, not the whole file.** Twenty-four files here are
   over forty thousand characters, and the largest are over a hundred and
   twenty thousand: `app/jobs/(app)/roles/[id]/panels.tsx` is about
   thirty-four thousand tokens, and `lib/plan/tree.ts`,
   `app/dev/plan/actions.ts` and `lib/plan/tree.test.ts` are fifteen to
   nineteen thousand each. Opening one whole to change three
   hundred lines costs that once to read and again on every turn afterwards,
   because the session carries it to the end.

   So find the line first and read around it: `grep -n` for the symbol, then
   read with an offset and a limit. Read a whole file only when you are
   changing most of it. The same goes for a file you have just edited -- the
   edit told you what it now says, so do not read it back to check.

   **Send a search you cannot narrow to a subagent.** "Which files construct
   this type", "where is this rule enforced", anything that means opening
   several files to find one answer: dispatch it and let it report back the
   paths, the line numbers and a sentence. Those files then cost you the
   sentence rather than their contents.

   Give that subagent `model: haiku`. Locating a symbol and reporting where it
   is does not need the model that writes the code, and the answer comes back
   the same. Keep the editing yourself, on the session's own model: a subagent
   that reads is cheap to be wrong about -- you can check the paths it names --
   and one that writes code you have not seen is not. Haiku holds 200K rather
   than 1M, so give it a search, not the whole feature.
6. **Verify before closing.** Three, every time:
   - `npx tsc --noEmit -p tsconfig.json` — whole project, about 25 seconds. An
     edit in one file breaks types in another, so this is not narrowed.
   - `npx eslint <the files you changed> --max-warnings 0`
   - `npx vitest run <the test files covering what you changed>` — the ones for
     the code you touched, not the whole suite.

   A step that changed a screen or added a page also runs `npm run
   check:contrast`, `npm run check:ui` and `npm run check:phone`, and
   a new route runs `npx vitest run lib/usage tests/sources-catalogue.test.ts`
   for the page list and the catalogue. These are the gate's checks that
   fail most often, and a failure found here costs a minute where the same
   failure found at the merge costs a second gate run. Run them before the
   critic, so the critic's shots are of the screen that will merge.

   Then check the done-when line by line. If a line is not met, it is not
   done. A step that changes a screen is not done until the critic has passed
   each of its surfaces. A third failed round blocks it instead (see
   **Building a screen**).

   **Do not run the full suite and do not run `next build`.** The session that
   sent you runs both when it merges your step to main, which is as soon as you
   report the commit; CI runs them again on main. Running them here first would only run
   them twice. The exception is a step whose done-when is about the build or
   about a test that the narrow run cannot reach: run what the done-when needs
   and say so in your report.
7. **Commit the step on its own.** One step per commit. End the subject with
   the step: `Add the anonymous share page (plan #14)`. A step that changed a
   screen has each critic round recorded in `public.ui_checks` before it
   commits (see **Building a screen**). **Do not push and do
   not merge.** The session that sent you puts your commit on main and closes
   your step from there, so stop at the commit and say in your report that you
   made it. If nobody sent you and this step is the whole job, the merge is
   yours: the procedure is step 4 of the Building section in `SKILL.md`, and
   the merge comes before the close.
8. **Before closing, look up once.** If the feature above your step carries
   fog, and what you just learned makes it specifiable, write those steps now
   — `add "…" --parent <the feature> --done-when "…" --size s|m|l` — and
   clear the patch with `fog <the feature> --clear`. Under a feature the
   person has approved they go in ready to build, marked as added by your
   session; under one still proposed they are proposals whatever you pass. A
   step among them that acts outside the repository takes `--proposed` (see
   **Steps that act outside the repository**). Say in your report what you
   graduated and what you cleared.

   Most of the time the answer is no, and no is the right answer: you are
   heads-down on one done-when and will miss most of what a re-shape would
   catch. But it costs a glance, and it means fog can dissolve without anybody
   pressing anything.

   With the decision below, this is the **only** rewriting you do beyond your
   own step: your own decisions, and fog you can now specify. Nothing else — no
   reordering, no dropping somebody else's step, no rewriting a done-when you
   disagree with, and never an approve.
9. **Hand the close over.** `done` refuses a commit that is not on main, and
   yours is on a branch nobody has merged yet, so the session that sent you
   closes the step once it has merged. Write the note it should close with —
   what changed, in one sentence — and put it in your report. If nobody sent
   you, merge first and then close it yourself: `done <n> --note "…"`, which
   records the commit from HEAD and names any steps that became ready.

## What to report back

You are one step in a batch, and the session that sent you keeps none of what
you read. Your report is the only thing that survives you, so write it for the
session building the next step:

- **The step, by number and title, and what you did to it** — committed, with
  the sha and the note it should close with; blocked, and on what; or put back,
  and why.
- **What changed**, as files and what each now does. Not a diff; the next
  session can read the diff. Name what it would otherwise have to go looking
  for.
- **What the next step needs to know.** The thing you worked out that is not
  written down anywhere — a helper that already existed, a shape the data turns
  out to have, a test that has to be updated whenever this changes, a rule in
  the code that was not obvious. This is the part that stops the next step
  re-deriving what you just learned.
- **The critic rounds**, for a step that changed a screen: each surface, how
  many rounds it took, and the last verdict. After a third failed round, the
  last verdict's fixes in full and where the shots are.
- **Anything you wrote outside your own step**: a decision and its dependency
  edge, fog graduated or cleared, an idea filed, a raise. By number and title.
- **Any step that became ready** when you closed yours.

Keep it to what the next session needs. A page is too long; three lines is too
short.

## Building a screen

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
   `sees` line) or "none", the step's done-when, the page pattern, and on
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
   problem, what it breaks (`law <n>`, `taste:<id>`, `pattern`, `done-when`
   or `regression`) and the change.
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

**Three rounds, then the person.** If round 3 comes back `fix`, stop the
loop: no fourth round, and no guess at what the critic would accept. A screen
that fails three rounds is usually missing a decision, such as which pattern
it should use, and that is the person's (decision #1535). So:

1. Record round 3 like any other (below).
2. Commit what you have and push your branch, so the work outlives the
   session.
3. Run `npm run ui-stop -- <step>`. It reads the recorded verdicts and prints
   the ask: each surface that did not pass, how many fixes are open, where the
   shots are and the branch, ending "accept it as it is, or say what to
   change". It also prints the last fixes in full, and the block to write:
   `plan.ts block <n> --ask "…"` with no `--on-steps`, or the statement for
   the connector. Write that block. It waits on the person, not on other
   steps.
4. Report the block, with the last verdict's fixes and where the shots are.

The person either accepts the screen as it is or says what to change, from
the step's row on /dev/plan, which shows the last fixes and shots (plan
#1610). Either way the step comes back ready, and its history says which:

- **Accepted** (a dated `Accepted …` line naming the branch): the person has
  written an `accepted` round for each surface that stopped, and the close
  guard counts it as passed. Do not build it again or run more rounds: merge
  the named branch and close the step.
- **Said what to change** (their words on the step's thread, and an
  `Answered …` line): the builder gets three fresh rounds, numbered on from
  4, against their words; the stop then falls on round 6, and so on.

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
   round, keeps a copy of the four shots beside it as
   `<step>--<surface>--r<round>--<shot>.png` (the next shoot overwrites the
   originals), and writes one row to `public.ui_checks`: step, surface,
   round, verdict, the fixes and the `earlier` list as the critic wrote them,
   its notes, and the shots' paths in the private `ui-shots` bucket. A round
   recorded twice is replaced, not duplicated.

What the recorder can reach depends on the session:

- With `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, it uploads
  the shots to `ui-shots/<user id>/<step>/<surface>/r<round>/<shot>.png`,
  which only the account can read, and writes the row.
- With only `DATABASE_URL`, it writes the row with no shots.
- With neither, as on the web, it prints the insert. Run that through the
  connector's `execute_sql` as it is printed. The critic's text is in base64
  inside it, so no apostrophe reaches the connector. The row is written with
  no shots, and the shots stay in `.preview-shots/checks/` for the report.
  Storage uploads do not go through SQL, so the connector cannot put them in
  the bucket.

A round whose recorder you could not run at all is not recorded: say so in
the report rather than leaving it out.

**The close checks the rounds.** `done` refuses a step whose commits change a
`.tsx` file under `app/` or `components/` while the latest recorded round of
any surface those files serve is not a `pass`, and names each such surface
(plan #1534, `lib/plan/ui-check-guard.ts`). `npm run ui-guard -- <n>` runs
the same check from your branch, and prints the SQL for the connector where
there is no `DATABASE_URL`. Run it before you report a screen step: a
surface it names is a round still to run or record.

## When you reach something you should not decide

Most choices are yours. The person takes the recommended option almost every
time, so a question you would answer with a recommendation they would very
likely accept costs them a visit to the page and holds the step up for
nothing. Decide it, build on it, and say what you chose and why in one line of
the note you close the step with, so they can still overrule it.

Stop and ask only when at least one of these holds:

- **It is hard to undo.** Deleting or rewriting their data, a stored shape
  that will fill up with data, anything sent outside the app, anything that
  costs money.
- **They could reasonably want it the other way, and nothing settles it.** It
  changes what they see or do, and neither the design laws, the code, an
  earlier answer nor the brief already points one way.
- **It changes the scope.** Whether to build something at all, or building
  noticeably more or less than the step asked for.

A fourth moment in one workspace always meets the second: the catalogue in
`app/dev/ui/moments.ts` holds three at most, and choosing which three is the
person's. `shaping.md` has the decision to write.

Names, wording, layout within the design laws, defaults, thresholds, ordering,
and which of two equivalent implementations to use are not on that list.

When one of them does hold, do not pick an answer and build on it. A guess
built on looks exactly like a decision from the outside. Write it down
instead, and stop:

```
npx tsx scripts/plan.ts add "Which shape for the export?" --parent <the feature> \
  --kind decision --detail "<the question, the two or three real options, what
  each costs, and which you would choose and why>"
npx tsx scripts/plan.ts depends <your step> --on <the decision>
npx tsx scripts/plan.ts block <your step> --on-steps \
  --ask "Which of the options on #<the decision>?"
```

`--on-steps` is what makes that block clear itself: the step is waiting on the
question you just wrote, the dependency edge names it, and answering it puts
the step back in the ready list without anybody unblocking it by hand. Leave
`--on-steps` off when the step is waiting on the person for something no row on
the plan will produce, and it stays blocked until they say otherwise. A key or
an account is not one of those: that is `needs`, in the next section, and it
writes the row and the edge for you.

Then report the block. Do not move on to another step; that is not your call.

The same two moves close out a merge that will not go through, when the merge
was yours because nobody sent you: push the working branch before you block the
step, and name that branch in the `--ask`. The work then outlives the session
that wrote it, and whoever picks the step up reads it instead of building it
twice. Leave the step open — its commit is on a branch, which is the thing
`done` refuses.

The recommendation is part of the job: a question with no proposed answer makes
the person do the reading you already did. What you must not do is act on your
own recommendation before they have agreed to it. **Never answer your own
decision** — not by running `answer`, not by writing the resolution into the
row, and not by building as though it had been settled.

**How a decision must be written.** The page shows a question in three parts —
the question, the options, the answer — and it can only do that if you write it
in three parts:

- **The title is the question**, as one sentence ending in a question mark. Not
  a topic. "Which shape for the export?" is a question; "Export format" is a
  filing label, and it is what the person has to answer from.
- **The options go in `--detail`, lettered, one option per line**, starting at
  `A` and running in order: `A — …`, then `B — …`. The letters are what turn
  the paragraph into options on the page and into one-click answers; prose
  options are shown as the prose they are. `(a)`, `A)`, `A.` and `A --` are
  read too. See `lib/plan/options.ts` for exactly what is recognised.
- **Each option opens with its own name in one short sentence.** That first
  sentence is what appears as the option; the cost and the reasoning follow it
  in the same paragraph and go under the fold.
- **Two or three options.** One is not a choice, and a set that skips a letter
  is read as prose rather than as options.

```
--detail "A — Ship it as CSV. One file, opens anywhere, loses the nesting.
B — Ship it as JSON. Keeps everything, needs something to read it.
Recommend A: the nesting is one column and nobody has asked for it."
```

A step that should not be done is `drop <n> --note "why"`; say "out of scope:
…" when that is the reason, since there is no status for it. Never delete a
step; deleting is the user's.

## Steps that act outside the repository

Under a feature the person has approved, the steps a session adds are ready
to build without asking. What still waits for their approval is a step whose
work has an effect outside the repository and the app's own schema. The rule
is the goals skill's ("Steps that act outside the plan"), with the plan's
examples:

- sending, replying to or forwarding an email, or posting any other message:
  a comment on a GitHub issue or on someone else's pull request, a note in a
  channel;
- submitting, booking, buying, cancelling or signing up for anything: a
  domain, a paid plan or credits, a form to an app store or a registrar;
- posting or sharing anything, or changing who can see it: publishing a page,
  opening a repository, changing a file's permissions;
- changing records outside the repository: a Vercel project's settings or
  environment, DNS, another service's configuration, or the person's own rows
  in the live database when the change rewrites or deletes what they wrote.

Writing code, tests and documents, committing, the merge to main, and
applying a migration the step needs all stay inside, as `CLAUDE.md` says.

Such work is a step of its own, added with `--proposed`:

```
npx tsx scripts/plan.ts add "Point the dashboard domain at Vercel" --parent <n> \
  --proposed --size s --detail "Changes the A record for dash.example.com in
  Cloudflare to Vercel's address, replacing the current Netlify one." \
  --done-when "dash.example.com serves the app over HTTPS."
```

The detail opens with one sentence naming exactly what working it does: who
it goes to, from where, and what changes. Put the step that prepares it (the
draft, the config written in the repo) before it as an ordinary step, so the
person reads what would be sent or changed before approving it. Nothing works
the step until they approve it on `/dev/plan`; after that it is built like
any other.

When a ready step turns out to need one of these, do the part inside the
repository, and add the outside part as a proposed step rather than doing it
under the ready step's approval. The same goes when what an approved outside
step would do changes: propose a new step instead of widening the old one.

This is not a setup step. A setup step, written with `needs`, is a job the
person does themselves, such as setting a key only they hold; it is theirs
from the start and is never proposed. An outside-the-repository step is work
a session would do once the person agrees to it.

## When the step needs something only the user can supply

An API key, an account, a value set in somebody else's dashboard, a record in
DNS. That is not a wall you block on — it is a job of theirs that nobody has
written down. Write it:

```
npx tsx scripts/plan.ts needs "Set GITHUB_TOKEN in Vercel" --for <your step> \
  --detail "<where to go, what to click, what the value has to be>"
```

That writes two things. A `setup` step, assigned to the person, under the same
feature as your step, so it sits beside the work it is holding up. And the
`plan_dependencies` row from your step to it, so your step reads as waiting on
a row on the plan rather than as a session stuck. Closing the setup step is
then the whole of freeing your step: nothing has to be unblocked by hand. If
your step was already `blocked`, `needs` puts it back to not started and clears
the ask. Report both numbers.

**The title is the one-line summary and `--detail` is what to actually go and
do.** The page shows the title in a list and the detail in a box labelled
"What to set up", so instructions written as the title leave that box saying
nothing the heading did not.

A setup step is never yours. It closes when the person says they have done it,
on `/dev/plan` or in the Dash tab's "Waiting on you", and it carries no commit.
`start` refuses one, the same as a decision, and `next --claude` never lists
one.

`block <n> --ask "…"` without `--on-steps` is still right for the rest: the
person has to decide something or say what they want, and there is nothing you
could write instructions for. That is the test — if you can say what doing it
involves, it is a setup step; if what you need is their opinion, it is a block.
The ask is rewritten on every block, so it is what the step needs now; `--note`
is for anything else worth recording, and that is appended to the history in
the comment.

### Write the ask for someone with no context

The person reads an ask days later, on a phone, between other things, and
does not remember what the step drew or which commit holds it. On #1600 and
#1603 they were asked to accept "them as drawn" and could not tell which
screens were meant, and the screens were on a branch they had no way to open
(notes d3fc7228 and 6d61486b). So every ask, and above all one that asks them
to look at screens:

- **Names the screens as the app names them**, page by page: "the account
  page, and these Dev pages: bugs, changelog, ideas". A surface id, a step
  number or a commit hash is never the only name for anything; when one is
  given, the sentence also says what it covers.
- **Says where to look, with a link for each screen**: `/preview?s=<id>`,
  which opens that drawing in the gallery on the live site.
- **Puts what it asks them to look at on main first.** A link only opens what
  main has, and branch deployments are switched off (`vercel.json`). A
  gallery drawing is safe to merge before it is accepted: `/preview` is the
  owner's alone, and an entry changes no page anyone uses. So merge the
  drawings, as the batch merge does, before writing the ask. Where the work
  cannot reach main (the gate will not pass, or the drawing needs a page
  change that is not ready), the ask says so and says where the shots are,
  rather than offering a link to something they cannot open.
- **Ends with the move wanted** in words they can answer in one line, such as
  "accept these as drawn, or say what to change on which one".

The critic stop (`npm run ui-stop`) writes its ask with the links already in
it. A hand-written ask is held to the same.

## The other two files you may need

- **`writing.md`** — how to write a title and a detail. Read it before you
  write any row: a sub-step, a decision, fog, an idea, or the note you close
  with.
- **`raising.md`** — the four places something a session has to say can go, and
  which one takes what. Read it when you have something to say that does not
  belong to the step in front of you.

## Statuses, kind and fog

- `proposed` — waiting on the person. Never yours to move.
- `not_started` — agreed, nothing has claimed it.
- `in_progress` — a session has claimed it and is on it. You set this with
  `start` and clear it by closing. It means one thing: somebody is on this
  right now.
- `blocked` — cannot proceed; the note says what is needed.
- `done` — closed against its done-when. Carries the commit.
- `dropped` — decided against; the note says why.

Waiting on another step is not a status — it is a row in `plan_dependencies`,
and it clears itself when the other step is done. Do not mark a step `blocked`
for that; add the dependency instead. "Out of scope" is not a status either: it
is `drop <n> --note "out of scope: …"`.

**Kind** is `build`, `decision` or `setup`. A decision is a question put to the
person, and it is never yours to answer, however it is assigned and whoever
named it. A setup step is a job of theirs outside the repo, written with
`needs`; it closes when they say they have done it and carries no commit.
Neither is ever closed by a session.

**Fog** is one sentence on a feature: what cannot be seen yet about finishing
it. `done` refuses a feature that still carries fog, so fog is cleared by
graduating it into steps (step 8 above), not by ignoring it.

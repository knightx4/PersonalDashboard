# Notes from a project's own app

A project in Dev (a row in `dev_projects`, such as music-pipeline) is built in
its own repository and often has an app of its own. That app can carry the same
kind of note button Dash has, so a bug or a change is written down where it
happens. The music studio is the first app to have one.

## Where a note goes

The app posts the note to `POST /api/projects/<project id>/notes` with
`{ body, page }` and a bearer token. Dash then:

1. checks the token against the project's key table and files the note as an
   idea under the project (`ideas.module` is the project id), with the page in
   its body;
2. triages the idea (`triageRow`, the same five questions a note gets);
3. if triage is sure it is one fix, adds a step under the project's standing
   feature "Fixes from notes filed in <project>" and links the idea to the step
   (`ideas.plan_item_id`). The projects routine builds that step in the
   project's repository;
4. otherwise sends it straight on to be shaped into a feature of its own on
   the plan, scored first when Jev is on (`sendIdeaToPlan` in
   `lib/ideas/send-to-plan.ts`). Nothing waits on the ideas page for a press.
   This is the same path a note from Dash's own header takes, so every app
   with a note button behaves alike. The shaping brief names the project's
   repository, so the session reads that code and files the feature under the
   project.

The answer tells the app which happened: `{ ok, as: 'step', number }` or
`{ ok, as: 'idea' }` (sent to be shaped), with a `message` to show.

Notes from an app never enter Dev · Notes. The notes routine works in this
repository, and a fix to another project would be made in the wrong place.

The code is `lib/project-notes/` (`route.ts` decides, `file.ts` writes,
`keys.ts` holds the registry) and `app/api/projects/[id]/notes/route.ts`.

## Connecting another app

1. **A token.** The app needs a token Dash gave it, stored in a table whose
   `key_hash` column holds each token's sha-256 in hex. The studio reuses the
   one "Open studio" mints (`studio_mint_key`, migration 0288). Another app can
   copy that pattern: a key table, a mint function only the owner may call, and
   a route like `app/dev/studio/route.ts` that opens the app with the token and
   the notes address (`projectNotesUrl`) in the address's fragment.
2. **The registry.** Add the project to `PROJECT_NOTE_KEYS` in
   `lib/project-notes/keys.ts`, naming its key table.
3. **The site.** The project's `url` in `dev_projects` is the origin allowed to
   call the endpoint from a browser (localhost is always allowed).
4. **The button.** Copy `studio-app/src/notes/` from music-pipeline
   (`client.ts` sends, `button.ts` draws the button and the box with its own
   styles and no framework) and mount it once:

   ```ts
   mountNoteButton({
     target: () => ({ endpoint: savedNotesUrl, token: savedToken }),
     page: () => 'Where in the app you are',
   });
   ```

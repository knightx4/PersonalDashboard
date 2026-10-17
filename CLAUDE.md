# Working in this repository

## Migrations are applied, not offered

**Apply every migration you write to the live Supabase project, in the same
sitting, without asking.** The Supabase connector is always available; use it.

A migration that sits in `supabase/migrations/` unapplied is worse than no
migration: the code that needs it is already on main, so the app reads a column
the database does not have and the page fails for real. That has happened here
repeatedly — learn migrations 0015 through 0019 sat unapplied while the Learn
pages read columns that were not there, and each one turned into a raise
nobody acted on.

So the order is: write it, apply it, check it landed, then say what you did.
Reading the file before applying it is the one part that stays — never apply
SQL you have not read.

The same goes for anything else the connector can settle. Do not ask
permission for a read, for applying a migration, or for a write the work
plainly requires. Ask only when the answer genuinely changes what gets built,
or when something is destructive and irreversible — dropping a table, deleting
rows, rewriting data that cannot be recovered.

Project ref: `asjztutnqxbecruvyrbj`.

## Only the owner's account is touched

The database holds more than one account. Every read, write, data fix and
investigation a session does through the connector is scoped to the owner,
**selveyknight4@gmail.com**, user id `d001bb0f-ffe8-4bfb-880f-17dd1a62b685`:
put `user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'` (or the join that
reaches it) in every query over a table that holds people's rows. The
connector runs as a superuser and row-level security does not apply to it, so
an unscoped query reads and changes everyone's rows. On 16 October 2026 a scan
for duplicate companies read every account and a merge was run in another
person's account. Never change another account's rows, and do not read them
beyond the counts a schema change needs.

Migrations follow the same rule. Schema changes (tables, columns, functions,
policies) apply to the database as a whole, but an `update`, `delete` or
`insert` over existing rows is written against the owner's id, never across
all accounts. Migration 0056 of migrations-job-search cleaned every account's
company domains; that is the kind of statement this rules out.

## Rows are written through scripts/sql.ts

A session reads and writes the person's rows with `npx tsx scripts/sql.ts`,
not the connector's `execute_sql`. The connector holds some statements for a
confirmation that never reaches a cloud session: the call waits 60 seconds,
runs nothing, and the person's phone gets a "Claude needs your input"
notification with nothing to answer. In a routine every one of those is a
false alarm.

```sh
npx tsx scripts/sql.ts "select … where user_id = 'd001bb0f-…'"
npx tsx scripts/sql.ts --set goals.actor=claude --set goals.run_id=<id> "insert … returning id"
npx tsx scripts/sql.ts --file /path/to/statement.sql   # for long text; avoids shell quoting
```

It sends one statement per call over HTTPS with the service-role key and
prints the rows as JSON. Each `--set` stands in for a `set local` and lasts
for that statement alone. It takes selects, inserts and updates, and refuses
a write that does not name the owner's id
([lib/db/sql-guard.ts](lib/db/sql-guard.ts)). It refuses deletes, truncates
and schema changes: a schema change goes in a migration file, and a delete is
left for the person (or, where a skill calls for one, sent once through the
connector). If `node_modules` is empty, run `npm ci` first.

When a connector call times out, never send it again: it did not run, and
each retry is another notification. Select the row to confirm, then move on
or write the step up as blocked.

Main applies its own migrations. On every push to main that touches a supabase/migrations*/ folder, .github/workflows/migrations.yml runs scripts/apply-migrations.ts, which applies each file the live history lacks under the name described below, through the Management API with the SUPABASE_ACCESS_TOKEN repository secret. A failed migration turns that run red. So a migration the connector will not let you apply, such as one containing a delete, is not a reason to hold a feature off main or to raise it for the person: merge it and the workflow applies it. Apply through the connector when the code on your branch needs the change before it merges.

The connector does not refuse such a statement: it waits about 60 seconds for a confirmation that never reaches a cloud session, then times out with nothing applied. Do not retry it. A plain `select` of a function that deletes inside goes through.

Before merging a migration to main, push the branch and read its **Rehearse migrations** run (.github/workflows/migrations-rehearse.yml). It runs the branch's unapplied files against the live database in one transaction and rolls it back, so a migration that only fails on the real rows, such as an index the existing data violates or a cleanup that catches more than it meant to, shows red on the branch instead of on main after the code that needs it has deployed. Fix a red rehearsal before merging. A file with its own `begin`/`commit` or `create index concurrently` cannot be rehearsed and the run says so.

Apply a migration under its file's own name: `0096_plan_main_deploy_and_migrations.sql`
goes in as `plan_main_deploy_and_migrations`, or with its folder in front
(`learn_0026_catalogue_judgements`). The status line's CI panel compares the
files on main with the live history by that name
([lib/plan/migrations.ts](lib/plan/migrations.ts)), and reports a migration
applied under any other name as missing. For files newer than
`LOOSE_NAMES_THROUGH`, a module folder's file must carry its folder in front:
a bare `merge_ideas` would match a file of that name in any folder, so it no
longer counts, and the workflow on main would apply the file again.

The connector is the claude.ai **`Supabase`** one, whose tools are
`mcp__Supabase__*` and are loaded through ToolSearch before the first call.
This repository has no `.mcp.json`, on purpose: the direct server it used to
configure could not get through the cloud proxy, and its failure notice at
session start kept being read as the connector being down. Do not recreate
it, even where the vendored Supabase skill says to.

## Run the gate before pushing to main

Every session that pushes to main runs `npm run gate` first, after merging
`origin/main` into its branch, and pushes only when it ends with `gate: all
clear`. The gate ([scripts/gate.sh](scripts/gate.sh)) runs the same checks as
CI's three jobs, starting the local test database the tests/ suite
needs. It takes about three minutes.

Several sessions merge to main at once, and nothing on GitHub stops a red
merge. On 23 September 2026 main stayed red for fourteen hours through seven
failures, every one of which the gate catches. If the gate fails on something
another session merged, fix that too before pushing: what you push is main.

## A spec count that rises fails the gate

Some spec rules are checked by a count, such as how many tables hold a comment
thread, that may go down and never up. The counters are in
[scripts/spec-counts.ts](scripts/spec-counts.ts) and their recorded values in
`scripts/spec-baseline.json`; `npm run check:specs` runs them, and the gate
runs it too. When one rises, your change has added another of the thing the
rule is working to remove: take the addition out, or remove one elsewhere to
make room. Do not edit the baseline upwards. When your change lowers a count,
the check writes the lower value into the baseline, and you commit that file
with the change. `npm run check:specs -- --list` prints what each counter
counted.

## Write to the writing guide

[docs/WRITING-GUIDE.md](docs/WRITING-GUIDE.md) is the standard for everything
written here: specs and other documents, commit messages, plan detail and
acceptance criteria, comments on the dev pages, and replies from Dash.

It began as a rubric for spotting AI slop after the fact, and it is more useful
applied while writing. Read it before writing a document, and re-read a draft
against its four failure modes before committing one. The most common offenders
in this repository have been slogans used as section summaries, em dashes
manufacturing rhythm, and inflated contrast of the "not X, it's Y" form.

## New tables go in the catalogue

Every table the migrations create is either a source Goals may read or listed
as not one, in its module's `sources.ts` ([lib/sources/types.ts](lib/sources/types.ts)).
A new table in neither list fails the gate (`tests/sources-catalogue.test.ts`).
When you add one, decide which it is: a table that holds what the person
wrote, wants, did or has is a source; settings, join rows and bookkeeping are
not. Then run `npm run sources:write` so the goals routine reads the new list.

## The assistant is Dash

In anything the person reads, the assistant is **Dash**, never "Claude": labels,
buttons, empty states, error messages, and what runs write into the app
(results, files, notes, replies). Code identifiers, database values such as
`made_by = 'claude'`, and the prompts a run is given can keep the name. The
one exception is where the app names the vendor as a fact, such as the privacy
page saying which models read your notes.

## Secrets are the exception

A value only the person has — an API token, a deployment secret — cannot be
guessed or generated on their behalf without saying so. Set what you can
determine yourself, name exactly what is left, and say where it goes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

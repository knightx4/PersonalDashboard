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

Apply a migration under its file's own name: `0096_plan_main_deploy_and_migrations.sql`
goes in as `plan_main_deploy_and_migrations`, or with its folder in front
(`learn_0026_catalogue_judgements`). The status line's CI panel compares the
files on main with the live history by that name
([lib/plan/migrations.ts](lib/plan/migrations.ts)), and reports a migration
applied under any other name as missing.

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
CI's check and design jobs, starting the local test database the tests/ suite
needs. It takes about three minutes.

Several sessions merge to main at once, and nothing on GitHub stops a red
merge. On 23 September 2026 main stayed red for fourteen hours through seven
failures, every one of which the gate catches. If the gate fails on something
another session merged, fix that too before pushing: what you push is main.

## Write to the writing guide

[docs/WRITING-GUIDE.md](docs/WRITING-GUIDE.md) is the standard for everything
written here: specs and other documents, commit messages, plan detail and
acceptance criteria, comments on the dev pages, and replies from Dash.

It began as a rubric for spotting AI slop after the fact, and it is more useful
applied while writing. Read it before writing a document, and re-read a draft
against its four failure modes before committing one. The most common offenders
in this repository have been slogans used as section summaries, em dashes
manufacturing rhythm, and inflated contrast of the "not X, it's Y" form.

## Secrets are the exception

A value only the person has — an API token, a deployment secret — cannot be
guessed or generated on their behalf without saying so. Set what you can
determine yourself, name exactly what is left, and say where it goes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

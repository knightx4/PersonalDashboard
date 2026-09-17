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

## Secrets are the exception

A value only the person has — an API token, a deployment secret — cannot be
guessed or generated on their behalf without saying so. Set what you can
determine yourself, name exactly what is left, and say where it goes.

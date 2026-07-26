# Cursor handoff

Paste the block below into Cursor as the opening message. It covers where the
project is, the first thing to do (getting Supabase authorized), and the rules
that are enforced by lint and tests rather than by convention.

---

I'm continuing work on this repo. Read `README.md`, `docs/SETUP.md` and
`docs/BUILD-ORDER.md` first — they have the full picture. Summary below.

## What this is

A shopping dashboard that tracks what I already own, prevents double buying, and
holds things I want to buy in a queue instead of a cart. It reads order
confirmations from email and turns them into inventory plus a spending picture.
It is not a delivery tracker and never handles payment.

## What already exists

Build order steps 1–5 are done, on branch `claude/project-setup-planning-jsya8c`.
74 tests pass, typecheck and lint are clean, the production build succeeds.

- **Next.js 16** (App Router, TypeScript, Tailwind v4). Note: Next 16 renamed
  `middleware.ts` to `proxy.ts` — route protection lives in `proxy.ts`.
- **Database**: 14 tables as SQL migrations in `supabase/migrations`, which are
  the source of truth. `lib/db/schema.ts` is a Drizzle mirror for typed queries.
  RLS on every table. 18 system categories and 86 merchants seeded as
  migrations.
- **`tests/rls.test.ts`**: cross-user isolation. It reads the table list from
  `pg_tables` and asserts its own seed covers all of them, so adding a table
  without a policy fails immediately. If you add a table, add it to
  `seedEverything()` there.
- **`lib/money.ts`**: all money math. Integer cents, proportional landed-cost
  allocation, spend net of refunds. The January/March return fixture from the
  acceptance criteria passes.
- **`lib/status.ts` + `public.sync_order_state()`**: derived order and inventory
  status. The Postgres function is the owner; the TypeScript is a mirror, and
  `tests/status.test.ts` asserts the two agree.
- **`lib/fingerprint.ts`**: strict (order dedup) and loose (already-own)
  fingerprints.
- **Auth**: email/password plus Google sign-in via Supabase, route protection in
  `proxy.ts`.
- **App shell**: top nav, contextual left rail, five sections each with a real
  empty state. Design tokens in `app/globals.css`.
- **`/privacy` and `/terms`**: written against actual retention behaviour,
  because Google reads them during verification. They carry `[TODO]` markers for
  legal entity and contact address.

## First task: get me authorized with Supabase

I have a Supabase account but no project yet. There's a script that does the
whole thing — `./scripts/provision-supabase.sh`. It logs me in, creates the
project, applies every migration, and prints the environment block.

Walk me through running it, then help me put the output into `.env.local`. Tell
me exactly what to paste where. If anything in the script fails, fix the script
rather than working around it by clicking in the Supabase dashboard — anything
clicked into a dashboard exists nowhere in version control and will not survive
a rebuild.

I do **not** need Vercel or Google Cloud yet. Vercel is for deploy time; Google
Cloud isn't needed until build step 10. Don't front-load either.

## Then: build step 6

Manual order entry plus inventory CRUD. This gets the whole UI working against
real data without touching email, and is the fastest way to find out whether the
data model is right.

- A form to add an order: merchant, order number, date, line items with
  quantity and unit price, plus tax, shipping and discount.
- On save, create one `inventory_items` row **per physical unit** (quantity 3
  makes 3 rows), with `cost_cents` from `allocateLandedCost()` in
  `lib/money.ts`. Do not write your own allocation.
- Inventory list and detail: search, filter by category, mark disposed (with
  method and optional proceeds), mark returned, edit, add note.
- Orders list grouped by month, and an order detail view.

Do step 6 only. Don't jump ahead to the dashboard or email ingestion.

## Rules — two of these are enforced by lint and will fail the build

1. **Money is always integer cents, and all money math lives in
   `lib/money.ts`.** Never a float, never inline arithmetic in a component. A
   lint rule blocks `Intl.NumberFormat` outside that file.
2. **The service-role client (`lib/db/admin.ts`) bypasses RLS** and cannot be
   imported from `app/`, `components/`, `lib/auth/` or `proxy.ts`. A lint rule
   enforces it. Use `lib/auth/server.ts` in app code.
3. **Order and inventory status are derived, never assigned.**
   `public.sync_order_state()` owns them, fired by triggers. Never write
   `orders.status` or set `inventory_items.status = 'returned'` directly.
4. **Never take a `user_id` from a request body or query param.** It comes from
   the session via `getUser()`.
5. **Schema changes go in a new numbered migration** under
   `supabase/migrations`, and get mirrored into `lib/db/schema.ts`. Never edit
   the database through the dashboard.

## Running the tests

40 of the 74 tests need a real Postgres 16 on port 5433 — RLS policies and
trigger-derived columns can't be meaningfully faked, so they run against an
actual database.

```bash
export TEST_DATABASE_URL=postgresql://postgres@localhost:5433/shopping_manager_test
npm run db:reset   # drops, recreates, applies every migration in order
npm test
```

`db:reset` applies `supabase/local/00_auth_shim.sql` first, which recreates the
parts of Supabase's `auth` schema the migrations need (`auth.users`,
`auth.uid()`, the `anon`/`authenticated`/`service_role` roles). That file is
local-only and never goes to Supabase.

Run `npm test`, `npm run typecheck` and `npm run lint` before telling me
something is done.

## Known open questions — ask me, don't decide these yourself

- Should groceries and consumables appear in inventory at all, or count toward
  spend but be excluded from the inventory view?
- Gift purchases: things bought but not owned. Probably an `is_gift` flag on
  `order_items` that counts toward spend and skips inventory — deliberately not
  in the schema yet.
- Household / shared accounts. This is the one feature that breaks the current
  `user_id` model and would mean touching every RLS policy. Worth deciding
  before launch, not after.

## One thing to be skeptical of

The `default_return_window_days` values seeded in
`supabase/migrations/0006_seed_merchants.sql` came from an AI's general
knowledge, not from a source. About 60 of 86 merchants have one; the rest are
deliberately null, on the principle that a wrong return deadline is worse than
none. They should be spot-checked before users act on those dates.

# Shopping Manager

A shopping dashboard that tracks what you have already bought, prevents double
buying, and holds things you want to buy in a queue instead of a cart.

The distinction from the Shop app: Shop is a delivery tracker. This is an
ownership and spending tool. Shop tells you where your package is. This tells
you that you already own two of these and spent $340 at this merchant last
month.

## Status

Build order steps 1–6 are done. See [docs/BUILD-ORDER.md](docs/BUILD-ORDER.md)
for what is next.

| | |
|---|---|
| Schema, RLS, seeds | done |
| Cross-user isolation test | done |
| `lib/money.ts` + spend fixture | done |
| Auth (email/password, Google sign-in, route protection) | done |
| App shell, design system, empty states | done |
| Manual order entry + inventory CRUD | done |
| Gmail inbox connect (OAuth, encrypted tokens) | done |
| Email extraction + order import sync | done |
| Dashboard, saved items, incremental sync | not started |

## Getting started

Read [docs/SETUP.md](docs/SETUP.md) first — it lists the handful of things that
need a human with a browser, and when you actually need them.

```bash
npm install
cp .env.example .env.local   # fill in Supabase values
npm run dev
```

To run the full test suite you need a local Postgres 16 on port 5433:

```bash
npm run db:reset
npm test
```

## Layout

```
app/
  (auth)/          login, signup, reset, callback
  (app)/           dashboard | orders | inventory | saved | review | settings
  (legal)/         privacy, terms   (required for Google verification)
proxy.ts           session refresh + route protection
lib/
  db/schema.ts     Drizzle schema, mirrors supabase/migrations
  db/admin.ts      service-role client -- importable ONLY from inngest/ and scripts/
  auth/            server + browser Supabase clients, getUser helper
  money.ts         integer cents, allocation, spend. ALL money math lives here
  status.ts        derived order + inventory status
  fingerprint.ts   strict + loose
supabase/
  migrations/      the source of truth for the database
  local/           auth shim for the local test database only
tests/             RLS isolation, status agreement
```

## Rules

These are enforced by tests and lint rules, not by convention.

- **Money is always integer cents**, and all money math lives in `lib/money.ts`.
  Never a float, never inline arithmetic in a component. A lint rule blocks
  `Intl.NumberFormat` outside that file.
- **Order and inventory status are derived, never hand-written.**
  `public.sync_order_state()` owns them; `lib/status.ts` restates the rule and a
  test asserts the two agree.
- **Every query goes through RLS.** The service-role client lives only in
  `lib/db/admin.ts` and is importable only from `inngest/` and `scripts/` — a
  lint rule fails the build otherwise. Even there, filter by `user_id`
  explicitly, because nothing else will.
- **Never trust a `user_id` from a request body or query param.** It comes from
  the session or it does not exist.
- **Sign-in with Google and the Gmail read grant are separate OAuth clients and
  separate consent flows.** Do not merge them.
- **Provider-specific email code lives behind the interface in
  `lib/email/providers/`.** Nothing outside that directory imports the Gmail SDK.
  This is also what keeps the aggregator escape hatch (Unipile, Nylas, Aurinko)
  available if CASA timing goes wrong.
- **All LLM output is parsed through a Zod schema** before touching the
  database, and never gates on self-reported confidence alone — the arithmetic
  check is the real gate.

## Non-goals

Listing these because they will otherwise get invented.

- No price comparison or affiliate shopping. Not a deal site.
- No checkout. Never handles payment.
- No bank or card connection in v1. Email only.
- No social features, sharing, or feeds.
- No browser extension in v1.

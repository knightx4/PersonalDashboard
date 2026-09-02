# Personal Tracker

Three workspaces behind one login, one deployment and one database.

**Shopping** (`/shopping`) tracks what you have already bought, prevents double
buying, and holds things you want to buy in a queue instead of a cart. The
distinction from the Shop app: Shop is a delivery tracker. This is an ownership
and spending tool. Shop tells you where your package is. This tells you that
you already own two of these and spent $340 at this merchant last month.

**Job search** (`/jobs`) tracks applications from lead to offer — a pipeline
board, the roles and companies behind it, contacts, interviews, an answer bank
and the funnel maths over all of it.

**Vault** (`/vault`) mirrors an Obsidian vault from a git repository and makes
it readable and searchable here. Markdown only — attachments are never even
requested. It is a viewer today; what it is *for* is in
[docs/VAULT-SPEC.md](docs/VAULT-SPEC.md).

They share an account and a design system, and the first two share one mailbox.
Otherwise nothing. Each owns its own Postgres schema in one Supabase project —
`public` for shopping, `job_search` for the job side, `vault` for the notes —
and ingestion sits in `core`, because an order confirmation and a rejection
letter arrive on the same sync and neither workspace owns that fact. See
[docs/SETUP.md](docs/SETUP.md).

## Status

Build order steps 1–14 and books/sell assistant (16–18) are done. See
[docs/BUILD-ORDER.md](docs/BUILD-ORDER.md) for what is next.

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
| Dashboard | done |
| Saved items (URL unfurl + queue CRUD) | done |
| Onboarding + Gmail pre-consent | done |
| Incremental sync | done |
| Review queue | done |
| Owned-books ingestion + book_details | done |
| Sell assistant (buyback + Browse routing) | done |
| Job search workspace merged in (schema, routes, tests) | done |
| Unified ingestion (one grant, one sync, classifier fan-out) | done |
| Calendar invites parsed from ingested mail | done |
| Tier-1 JD fetch for nine ATS vendors | done |
| Company enrichment from Wikidata | done |
| Vault workspace (schema, git sync, viewer, connect UI) | done |

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
  vault/           notes | note detail | settings
  (legal)/         privacy, terms   (required for Google verification)
proxy.ts           session refresh + route protection
lib/
  db/schema.ts     Drizzle schema, mirrors supabase/migrations
  db/admin.ts      service-role client -- importable ONLY from inngest/ and scripts/
  auth/            server + browser Supabase clients, getUser helper
  money.ts         integer cents, allocation, spend. ALL money math lives here
  status.ts        derived order + inventory status
  fingerprint.ts   strict + loose
lib/
  vault/           providers/ (the git source, contained), sync/ (pure planning
                   + the runner), markdown/ (frontmatter and Obsidian syntax)
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
- **Nothing outside `lib/vault/providers/` knows the vault lives in git.**
  A lint rule fails the build otherwise, and `tests/lint-boundaries.test.ts`
  asserts the rule still fires. Same containment as the email providers.
- **The vault fetches markdown and nothing else**, and the filter runs against
  a listing rather than a download, so an attachment's bytes are never
  requested at all.
- **Notes render without raw HTML.** `rehype-raw` is not installed and must not
  be: with raw HTML disabled, `react-markdown` will not render the arbitrary
  markup a web-clipper note carries. That absence is the sanitizer.
- **The vault sync never advances its cursor past work it did not do.** A
  cursor is a promise that everything up to a commit is mirrored, and a promise
  made early is a permanent gap — the next run only asks for what changed since
  a point it never reached.

## Non-goals

Listing these because they will otherwise get invented.

- No shopping price comparison or affiliate deals. Not a deal site.
  Owned-item resale assist (sell assistant) is in scope; checkout is not.
- No checkout. Never handles payment. Sell assistant drafts; the human posts.
- No bank or card connection in v1. Email only.
- No social features, sharing, or feeds.
- No browser extension in v1.

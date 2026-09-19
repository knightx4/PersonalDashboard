# Personal Tracker

Five workspaces behind one login, one deployment and one database.

**Shopping** (`/shopping`) tracks what you have already bought, prevents double
buying, and holds things you want to buy in a queue instead of a cart. The
distinction from the Shop app: Shop is a delivery tracker. This is an ownership
and spending tool. Shop tells you where your package is. This tells you that
you already own two of these and spent $340 at this merchant last month.

**Job search** (`/jobs`) tracks applications from lead to offer — a pipeline
board, the roles and companies behind it, contacts, interviews, an answer bank
and the funnel maths over all of it.

**Todo** (`/todo`) holds the things you have to do that belong to no workspace,
and merges in the ones that do — a follow-up the job search is waiting on, a
return window about to close — without copying a single row. Each of those is a
source you switch on, and everything but your own list starts off.

**Vault** (`/vault`) mirrors an Obsidian vault from a git repository and makes
it readable and searchable here. Markdown only — attachments are never even
requested. It is a viewer today; what it is *for* is in
[docs/VAULT-SPEC.md](docs/VAULT-SPEC.md).

**Learn** (`/learn`) takes a list of things somebody told you to read and turns
it into a queue you can start: each item resolved to a link that opens, priced
if it is not free, and pointed at the chapter or paragraph worth reading rather
than at a 350-page book. Specified in
[docs/LEARN-SPEC.md](docs/LEARN-SPEC.md). The half after that — a graph of what
you know, probed rather than assumed — is in
[docs/LEARN-GRAPH-SPEC.md](docs/LEARN-GRAPH-SPEC.md), and how that map is
shaped and built from the vault is in
[docs/LEARN-MAP-SPEC.md](docs/LEARN-MAP-SPEC.md).

**Dev** (`/dev`) is the app looking at itself: the bugs and requests filed
from the header button, the build plan as a tree of features and the steps
that get you to each, and the long-term ideas that have not become either.
The plan is the source of truth for what gets built next, by a person or by a
Claude session — specified in [docs/PLAN-SPEC.md](docs/PLAN-SPEC.md).

They share an account and a design system, and the first two share one mailbox.
Otherwise nothing. Each owns its own Postgres schema in one Supabase project —
`public` for shopping, `job_search` for the job side, `obsidian` for the notes,
`todo` for the list, `learn` for the reading — and ingestion and account
settings sit in `core`, because
an order confirmation and a rejection letter arrive on the same sync, your
timezone belongs to none of them, and no workspace owns any of those facts. See
[docs/SETUP.md](docs/SETUP.md).

## Status

The live plan is `/dev/plan` in the app, and `npx tsx scripts/plan.ts list`
from a terminal. The documents below are where it came from and why each
step is where it is; the app is where it is worked.

Build order steps 1–14 and books/sell assistant (16–18) are done. See
[docs/BUILD-ORDER.md](docs/BUILD-ORDER.md) for what is next on the shopping
side, and [docs/EVIDENCE-LAYER.md](docs/EVIDENCE-LAYER.md) for the job side's
next body of work. [docs/SHARE-LINKS-SPEC.md](docs/SHARE-LINKS-SPEC.md) describes
share links — a page a person with no account opens and fills in — which now
carry a keep/sell/give-away form over the board game shelf.

The fourth workspace — **Todo** — is built: build order steps 24–31, specified
in [docs/TODO-SPEC.md](docs/TODO-SPEC.md). Reading `- [ ]` checkboxes out of
vault notes is deliberately not part of it and waits for the vault to hold
notes as something more structured than text.

The fifth workspace — **Learn** — has its sourcing and tracking slice built:
build order steps 32–36, specified in [docs/LEARN-SPEC.md](docs/LEARN-SPEC.md).
Curriculum generation from a bare topic is deliberately not part of it: it was
tested before the spec was written and is the weak half — expensive, gap-prone,
and quietly incomplete. Resolution is the reliable half and ships first.

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
| JD backfill from the employer's own ATS board | done |
| Vault workspace (schema, git sync, viewer, connect UI) | done |
| Account settings, one timezone for the whole account | done |
| Todo workspace (schema, list, links, agenda sources) | done |
| Share links (anonymous form, item families, disposition) | done |

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
  todo/            agenda | all | settings
  account/         settings that hold across every workspace
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
lib/
  core/account/    account settings -- the one timezone, and which modules are on
  todo/            tasks/ (pure model + queries), links/ (what a task is about),
                   agenda/ (the source interface, the registry, the pure merge)
lib/
  plan/            load (rows), tree (nesting, readiness, roll-ups -- pure),
                   brief (a step written out for whoever builds it), seed
scripts/
  plan.ts          the plan from a terminal: next, show, start, done, block
  notes.ts         the bug and request queue, likewise
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
- **A newsletter is the one thing rendered as HTML, and it is cleaned first.**
  #445 settled that an issue should look the way its sender designed it, which
  the rule above cannot give. `lib/news/issues/sanitize.ts` runs every issue
  through `sanitize-html` on the way out — script, event handlers,
  `javascript:` links, forms, frames and stylesheets all go, and every picture
  is held back until the reader asks for it — and what survives is shown in a
  sandboxed frame that cannot reach the page around it. Neither half is trusted
  alone. `lib/news/issues/sanitize.test.ts` asserts the first half. The rule
  above is unchanged: `rehype-raw` is still not installed, and notes still
  render without raw HTML.
- **A foreign key is not an ownership check.** Referential integrity in
  Postgres bypasses RLS, so every cross-schema link in `todo.task_links` is
  checked by a trigger as well, and `tests/rls-todo.test.ts` asserts a link to
  another account's row is refused. An isolation suite covering only the tables
  with their own `user_id` would pass with that hole wide open.
- **The todo module never copies a row out of another schema.** A foreign
  obligation is read at query time by its source and written back where it
  lives — finishing a job reminder sets `completed_at` on the job row,
  deferring it moves that row's `due_at`. There is no second place a reminder
  can be hidden, because two places would disagree.
- **Settings that survive every module being off belong to the account**, in
  `core.account_settings`, behind the account icon. Everything else belongs to
  its module's own gear. The two `profiles.timezone` columns are mirrors kept
  by a trigger, not a second writer.
- **A due date and a due instant are different columns.** "Tuesday" must not
  move because you flew to Lisbon; 14:30 must. Which also rules out indexing
  `coalesce(due_on, due_at::date)` — Postgres refuses it, because
  timestamptz → date is not immutable.
- **A shared link is a window, never an engine.** The anonymous page reads
  rows that already exist and does nothing else: no lookup, no enrichment, no
  billed call, no job, no outbound HTTP. `share_page()` is declared `stable`
  so Postgres will not let it write; an ESLint boundary keeps `lib/sell`, the
  game and book providers, `lib/fx`, `lib/email`, `inngest` and the Anthropic
  SDK out of `app/s/`, `app/api/s/` and `lib/share/read/`, and bans a bare
  `fetch` there; and `tests/share-read.test.ts` renders the page with `fetch`
  stubbed to throw. An unknown price renders blank, never `$0.00` — zero is a
  claim, and a game shown as worth nothing is a game someone gives away.
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

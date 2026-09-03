# Setup

Almost everything here is automated. The exceptions are the things that need a
browser, a human clicking consent, or a credit card. Those are listed below,
tier by tier, in the order you actually need them.

**You do not need most of this to start.** Only Tier 0 is required, and it takes
about fifteen minutes. Google Cloud is not needed until build step 10, which is
most of the way through the project. Do not front-load it.

---

## Three apps, one Supabase project

This deployment carries three workspaces behind one login: the commerce side at
`/shopping`, the job search side at `/jobs`, and the vault at `/vault`. They
share a Supabase project and take a schema each — `public`, `job_search` and
`obsidian` — plus `core`, which belongs to none of them.

The notes workspace is called Vault everywhere a person sees it, but its schema
is `obsidian`: `vault` is taken by Supabase Vault on every hosted project, and
its `secrets` table has no RLS.

Supabase bills per **project**, not per app, so this costs nothing extra. It is
also the only arrangement under which the two can share a database at all:
their tables collide on four names (`profiles`, `email_accounts`,
`ingested_messages`, `sync_jobs`), six enum types and two function names.
`create type` fails loudly on a duplicate, but **`create or replace function`
overwrites silently**, so a migration written against the wrong schema would
clobber the other app's `handle_new_user()` on a live database without erroring.
`tests/coexistence.test.ts` is what stops that reaching production.

`auth.users` is shared on purpose: **one login for both workspaces**. Each app
has its own trigger on it, since trigger names must differ —
`on_auth_user_created` for commerce, `on_auth_user_created_job_search` for the
job side — and each seeds its own profile row.

### `core`, and why ingestion is not in either schema

An order confirmation and a rejection letter arrive through the same mailbox on
the same sync. The fact that a message exists is not a commerce fact or a
recruiting fact, so `core` holds it: one Gmail grant, one sync run, and one
copy of each message envelope, deduplicated on
`(email_account_id, provider_message_id)`.

Each workspace keeps only its **verdict** — what it thinks a message is and
what it linked it to — in its own `ingested_messages`, keyed by the core
message id. Those really are different questions: the two
`message_classification` enums share no values.

Two consequences worth knowing:

- **Retention changed meaning.** The commerce table used to carry a check
  constraint that a message classified `not_relevant` must have a null subject,
  sender and thread. That worked while one app owned both halves. Now "not
  relevant" is one workspace's opinion, and a message commerce discards may be
  a rejection letter the job side is keeping — so the envelope is only scrubbed
  once *every* workspace has looked and none claimed it. That is
  `core.scrub_unclaimed_messages()`, run at the end of each sync.

- **A backfill re-reads scrubbed envelopes.** Most of the history here was
  scrubbed under the old single-app rule, before there was a job side to ask.
  Those subjects are gone from the database but not from the mailbox, so a
  backfill re-reads them, offers them to whoever has not judged them, and the
  sweep discards them again if the answer is still no. Incremental syncs leave
  them alone, so this is a bounded reconciliation rather than a loop that
  quietly undoes the retention rule.

Reading a message *with* a workspace's verdict goes through that schema's
`inbox_messages` view, which joins the two — PostgREST cannot embed across
schemas, so the join has to be in the database.

### The one step that is not in this repository

In the Supabase dashboard, under **Settings → API → Exposed schemas**, the list
must include **`job_search`, `core` and `obsidian`** alongside `public`.

Without it PostgREST refuses every request against the missing schema with
*"The schema must be one of the following"*, and because it is a dashboard
setting rather than a migration it is the step that gets forgotten after a
project restore or when setting up a second environment. Three things have to
agree — the migrations, the `db: { schema }` option on every client, and this
setting — and only the first two are in version control.

`obsidian` is the newest and therefore the one most likely to be missing: the
symptom is a Vault workspace that reports no connection and no notes on an
account that has both.

**Never add `vault` to that list.** That schema is Supabase's own — Supabase
Vault, the encrypted secrets store — and `vault.secrets` carries no RLS
because nothing is meant to reach it through PostgREST. The notes workspace is
called Vault and lives in `obsidian` for exactly this reason.

### Migrations

Three directories, and the order is **not** directory by directory:

| Directory | Schema | Versions |
|---|---|---|
| `supabase/migrations` | `public`, and `core` from 0029 | `0001`–`0036` |
| `supabase/migrations-job-search` | `job_search` | `0001`–`0013` |
| `supabase/migrations-vault` | `obsidian` | `0001` |

They are separate because the sets were numbered independently from `0001`, and
the `job_search` versions are already recorded remotely under exactly those
numbers. Renaming them would make the local files disagree with the deployed
history. **Do not renumber any set.**

The two older sets depend on each other in both directions:
`job_search/0006` hands ingestion to `core`, which `public/0029` creates, while
`public/0031` onward repair `job_search` rows. So the working order is public
through `0030`, then all of `job_search`, then the rest of public, then
`obsidian` — which is what `scripts/db-reset.sh` now does. Running the directories
straight through fails on `public/0031` with *"relation
job_search.application_events does not exist"*.

`job_search` `0001`–`0006` are applied remotely; do not re-run them.
**`0007`–`0010` are not**, and the code that depends on them is deployed, so
they want running against the project:

| Migration | What breaks without it |
|---|---|
| `0007_interview_invites` | An interview email carrying a calendar invite writes no interview row at all — the insert names columns that do not exist. This is the one to run first. |
| `0008_recruitee_ats` | Adding a role from a Recruitee URL fails on the `ats_type` enum. |
| `0009_relink_attempts` | The reprocess pass silently no-ops, so mail held in the review queue is never reconsidered. |
| `0010_repair_timezones` | Nothing breaks — reads already fall back — but a stored `ET` stays stored, and anything reading the column directly still sees it. |

### Storage

Buckets are project-wide rather than schema-scoped — the one place where
sharing a project is not automatic isolation. The job side uses its own private
bucket, `job-search`, for resumes and attachments. It exists. Nothing uploads to
it yet; when something does, `storage.objects` will need per-user policies,
since the bucket being private only stops anonymous reads.

### Backfilling profiles for existing accounts

The `on_auth_user_created_job_search` trigger only fires for new signups, so
accounts that existed before the merge have no `job_search.profiles` row — and
the signed-in job layout reads it with `.single()`, which errors on zero rows.
This has been run once already; it is idempotent, and it is what you want after
restoring a backup:

```sql
insert into job_search.profiles (id, display_name)
select u.id, split_part(u.email, '@', 1) from auth.users u
on conflict (id) do nothing;
```

---

## Tier 0 — before anything else. ~15 minutes.

| What | Where | Why you and not the agent |
|---|---|---|
| Supabase account | [supabase.com](https://supabase.com) | Signup and billing |
| Anthropic API key | [console.anthropic.com](https://console.anthropic.com), add ~$10 credit | Signup and billing |

Then run the provisioning script **on your own machine**:

```bash
./scripts/provision-supabase.sh
```

It signs you in, creates the project, waits for it to come up, applies every
migration in `supabase/migrations`, and prints a ready-to-paste `.env.local`
block (URL, anon key, service-role key, app URL, and a fresh
`TOKEN_ENCRYPTION_KEY`). Copy that whole block into `.env.local` at the repo
root. Do not commit `.env.local`.

> **This cannot be run from a Claude Code web session.** The login step needs a
> browser, and the sandboxed environment's network policy blocks
> `api.supabase.com` and `api.vercel.com` outright — so project creation and
> `db push` fail there too, not just login. Either run it locally as above, or
> allow those hosts in the environment's network policy
> ([docs](https://code.claude.com/docs/en/claude-code-on-the-web)).

Vercel is not needed until you actually deploy. When you get there:

```bash
npx vercel login
npx vercel link
npx vercel env add ...
```

For daily incremental Gmail sync (`vercel.json` cron → `/api/cron/inbox-incremental`),
set `CRON_SECRET` in Vercel env. Vercel Cron sends it as `Authorization: Bearer …`.
If unset, the route accepts `TOKEN_ENCRYPTION_KEY` as a local fallback. Hobby
allows at most one cron run per day; bump the schedule to hourly only on Pro.

Use the CLI rather than the dashboard throughout. Both produce the same result,
but the CLI leaves migration files in the repo, which is what makes the database
reproducible. Anything clicked into a dashboard exists nowhere in version
control and will not survive a rebuild.

---

## Tier 1 — before build step 4 (auth). ~15 minutes.

### Site URL and redirect allow-list (required for password reset / OAuth)

Email/password sign-up works with the defaults, but production redirects
(password reset, Google sign-in callback) need the allow-list pointed at the
deployed app. Prefer the script (needs a [personal access
token](https://supabase.com/dashboard/account/tokens)):

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...
./scripts/configure-supabase-auth.sh
```

Or set them in the dashboard under **Authentication → URL Configuration**:

| Field | Value |
|---|---|
| Site URL | `https://shopping.selveyknight.com` |
| Redirect URLs | `https://shopping.selveyknight.com/auth/callback` |
| | `https://shopping.selveyknight.com/**` |
| | `https://shopping-manager-amber.vercel.app/auth/callback` |
| | `http://localhost:3000/auth/callback` |

> **If Google sign-in dumps you on `localhost:3000`**, Site URL is still the
> Supabase default. Change it to the production URL above and save — Supabase
> falls back to Site URL whenever the `redirectTo` is missing from the allow
> list.

### Google sign-in (optional)

Only needed for the "Sign in with Google" button. Email/password works without
it, so this is skippable if you want to move faster.

1. Create a project at [console.cloud.google.com](https://console.cloud.google.com).
2. Configure the OAuth consent screen. External user type. App name, support
   email, developer email. Nothing else is required yet.
3. Create an OAuth 2.0 Client ID, type **Web application**. Authorized redirect
   URI is `https://<your-supabase-ref>.supabase.co/auth/v1/callback`.
4. Paste the client ID and secret into the **Supabase dashboard**, under
   Authentication → Providers → Google.

> These go in the Supabase dashboard, **not** into `.env.local`. Supabase
> performs that OAuth exchange, which is why no `GOOGLE_SIGNIN_*` variable
> appears in `.env.example`.

There is no API for creating OAuth client IDs, so that part is genuinely
console-only.

---

## Tier 2 — before build step 10 (Gmail). One to two hours.

This is the real setup work, and the only part that is more than clicking.

1. **Buy a domain** (~$12/year). Google requires a verified homepage, privacy
   policy and terms before a restricted-scope app can leave testing status.
2. **Verify domain ownership** in Google Search Console, via a DNS TXT record.
3. **Publish homepage, privacy policy and terms** on that domain. All three
   already exist in this app at `/`, `/privacy` and `/terms` — deploy and point
   the domain at it. The privacy policy is written against the actual retention
   behaviour rather than from a template; re-read it against the shipped
   ingestion code before submitting, and fill in the `TODO` placeholders (legal
   entity, contact address). A policy that does not match the app is a common
   rejection reason.
4. **Create the second OAuth client**, Web application, for the Gmail grant.
   Redirect URI `https://yourdomain.com/api/auth/gmail/callback`. Keep this
   separate from the sign-in client.
5. **Enable the Gmail API** on that same Google Cloud project
   ([API overview](https://console.developers.google.com/apis/api/gmail.googleapis.com/overview)).
   Connect can succeed without this (openid/email), but **Import orders** calls
   `users.messages.list` and fails with 403 until the API is enabled.
6. **Add the `gmail.readonly` scope** to the consent screen. It will be marked
   Restricted. That is expected.
7. **Set publishing status to "In production."** Single most important click in
   this list — see below.
8. Paste the two client values into `.env.local` as `GOOGLE_GMAIL_CLIENT_ID`
   and `GOOGLE_GMAIL_CLIENT_SECRET`, then have the agent push them to Vercel.

### Publishing status: set it to "In production" immediately

Publishing status and verification status are independent. Flipping to
production does **not** require review.

While status is **Testing**, Google revokes refresh tokens after 7 days, so
email sync silently dies every week and you will waste days debugging phantom
auth failures.

In **Production while unverified** you get:

- Refresh tokens that do not expire
- A "Google hasn't verified this app" interstitial before consent, cleared via
  *Advanced → Go to app*
- A cap of **100 users**

### The 100-user cap is lifetime and cannot be reset

It counts every account that has *ever* granted consent, permanently, even after
disconnection. **Do not burn slots on throwaway test accounts.** Use one or two
real accounts for development and keep a written tally — start it now, in
`docs/consent-tally.md`.

---

## Tier 3 — only when you want more than 100 users

Brand verification (free, a few weeks, mostly paperwork plus a demo video
recorded against a working build), then CASA Tier 2 (annual, low four figures,
6–12 weeks through a Google-authorized lab).

Start around user 60. Nothing to do now.

Building to pass CASA is mostly what this repo already does: encrypted tokens at
rest, no email bodies persisted, TLS everywhere, dependency scanning in CI,
documented deletion, least-privilege access. Keeping those honest from the start
turns the assessment into paperwork rather than remediation.

---

## Environment variables

`.env.example` is the full list. You paste three values in total:
`ANTHROPIC_API_KEY` (Tier 0), and the two `GOOGLE_GMAIL_*` values (Tier 2).
Everything else the agent fills in from CLI output.

Generate the token encryption key with:

```bash
openssl rand -base64 32
```

It must not be the anon key or the service role key.

---

## Local development

```bash
npm install
npm run dev
```

For the database tests you need a local Postgres 16 on port 5433:

```bash
export TEST_DATABASE_URL=postgresql://postgres@localhost:5433/shopping_manager_test
npm run db:reset   # drops, recreates, applies every migration in order
npm test
```

`db:reset` applies `supabase/local/00_auth_shim.sql` first, which recreates the
pieces of Supabase's `auth` schema the migrations depend on (`auth.users`,
`auth.uid()`, the `anon` / `authenticated` / `service_role` roles). That file is
local-only and is never applied to Supabase.

It then applies both migration sets into one database — `public` first, then
`job_search` — which is what lets `tests/coexistence.test.ts` assert against a
real neighbour rather than a stand-in for one.

### Checking the eBay keyset

The sell assistant prices books from eBay Browse when `EBAY_CLIENT_ID` and
`EBAY_CLIENT_SECRET` are both set, and falls back to a billed web-search
estimate when they are not. To find out which one is actually running, read the
note under the heading on `/shopping/sell` — it names the source.

To test the credentials themselves:

```bash
npx vercel env pull .env.local   # same values the deployment uses
npm run check:ebay -- 9780735211292
```

It loads `.env.local` itself, fetches an application token, runs one Browse
search, and prints either the price the assistant would use or the reason eBay
refused — the stage, the HTTP status and eBay's own error text. It exits
non-zero for a configuration fault and zero for a book that genuinely has no
listings, so the two cannot be confused.

Three faults account for most failures. The keyset must be the **production**
one (`-PRD-` in the client id); a sandbox keyset returns invented listings and
is refused outright. The application must have the **Buy APIs granted** — a
keyset is issued immediately, Browse access is a separate approval that takes
days, and until it lands OAuth succeeds while every search returns 403. And on
Vercel, variables only reach a deployment **built after** they were set, in the
environment you are actually visiting.

> **This cannot be run from a Claude Code web session** unless `api.ebay.com` is
> allowed in the environment's network policy; the proxy otherwise returns its
> own 403, which the script reports verbatim
> ([docs](https://code.claude.com/docs/en/claude-code-on-the-web)).

---

## Cron

`vercel.json` schedules one job, `/api/cron/daily` at 12:00 UTC. It runs two
things in order: the inbox sync — one pass over the mailbox, offered to both
workspaces — and then the job sweep that re-derives ghosted status and
generates reminders.

**One route rather than three, because the Hobby plan caps cron jobs per
project.** The order is not incidental either — a message that arrives in the
morning should count as activity before anything is judged quiet. Stages are
isolated: one that throws is named in the response and the others still run, so
a failure on the newer job side cannot stop a commerce sync that works.

**Daily, because sub-daily cron needs Vercel Pro.** The mitigation is the
**Check now** button in Settings, which runs the same sync on demand.
`/api/cron/inbox-incremental` and `/api/cron/jobs-sweep` remain reachable for
running one stage by hand.

All of them require `Authorization: Bearer $CRON_SECRET`. Vercel Cron sends it
automatically once `CRON_SECRET` is set; if it is unset, `TOKEN_ENCRYPTION_KEY`
is accepted as a local fallback so you can curl the routes in development.

---

## Running cost

| | Cost |
|---|---|
| Supabase | Free tier is enough. Free projects pause after a week of inactivity — move to Pro ($25/mo) once you use it daily |
| Vercel | Free on Hobby. Pro ($20/mo) required if this becomes commercial |
| Inngest | Free tier covers this comfortably |
| Anthropic | Pay as you go. A 500-email backfill on Haiku is on the order of a dollar |
| Domain | ~$12/year |
| CASA | Low four figures per year, Tier 3 only |

Realistically zero to start, about $45/month if it becomes a real product.

# Setup

Almost everything here is automated. The exceptions are the things that need a
browser, a human clicking consent, or a credit card. Those are listed below,
tier by tier, in the order you actually need them.

**You do not need most of this to start.** Only Tier 0 is required, and it takes
about fifteen minutes. Google Cloud is not needed until build step 10, which is
most of the way through the project. Do not front-load it.

---

## Four apps, one Supabase project

This deployment carries four workspaces behind one login: the commerce side at
`/shopping`, the job search side at `/jobs`, the vault at `/vault` and the todo
module at `/todo`. They share a Supabase project and take a schema each —
`public`, `job_search`, `obsidian` and `todo` — plus `core`, which belongs to
none of them and holds both ingestion and the account settings (your timezone
is not a fact about any one workspace).

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

### Exposed schemas

PostgREST only serves the schemas it has been told to serve. The list must
include **`job_search`, `core`, `obsidian`, `todo`, `learn` and `news`**
alongside `public` and `graphql_public`. A schema that is missing gets
`PGRST106 Invalid schema: …` on every request, which reaches the browser as
*"This page couldn't load — a server error occurred"*.

This used to be a dashboard setting only — **Settings → API → Exposed
schemas** — and being the one thing outside version control is exactly what
went wrong: `news` shipped with its migration, its clients and its pages, and
nobody ticked the box, so /news was a server error from the day it landed.
`supabase/migrations-news/0002_expose_news_to_postgrest.sql` moves the setting
into the database, where PostgREST also reads its configuration from
(`pgrst.db_schemas` on the `authenticator` role, which wins over the config
file). It appends rather than assigns, so it adds `news` without opinion about
what else is exposed, and running it twice does nothing.

A new schema should do the same: one migration that adds its own name, not a
note asking someone to remember. The dashboard still shows and edits the list,
and editing it there overwrites what the migration set — so if a schema goes
missing again after someone has been in Settings → API, re-running that
migration is the fix.

`todo` is the one whose absence is quietest: the symptom is a Todo workspace
that reports an empty list on an account that has one, and — because the
account settings live in `core` — a timezone that silently reverts to UTC
everywhere if that one is missing too.

**Never add `vault` to that list.** That schema is Supabase's own — Supabase
Vault, the encrypted secrets store — and `vault.secrets` carries no RLS
because nothing is meant to reach it through PostgREST. The notes workspace is
called Vault and lives in `obsidian` for exactly this reason.

### Migrations

Six directories, and the order is **not** directory by directory:

| Directory | Schema | Versions |
|---|---|---|
| `supabase/migrations` | `public`, and `core` from 0029 | `0001`–`0037` |
| `supabase/migrations-job-search` | `job_search` | `0001`–`0018` |
| `supabase/migrations-vault` | `obsidian` | `0001` |
| `supabase/migrations-learn` | `learn` | `0001`–`0007` |
| `supabase/migrations-news` | `news` | `0001` |
| `supabase/migrations-todo` | `todo` | `0001`–`0004` |

`migrations-todo` goes **last**, after all five of the others. Its
`task_links` table carries foreign keys into `job_search` and `obsidian` from
`0001`, and into `public` and `learn` from `0004`, so applying it earlier fails
on a table that does not exist yet. `scripts/db-reset.sh` already sequences the
directories this way; a fresh project must be migrated in the same order.

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
| Site URL | `https://dash.selveyknight.com` |
| Redirect URLs | `https://dash.selveyknight.com/auth/callback` |
| | `https://dash.selveyknight.com/**` |
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

## Newsletters — Mailgun and the DNS behind it

Mail sent to your newsletter address is received by Mailgun and posted to this
app as a form. Nothing is read out of a mailbox, and this is the only way an
issue is ever written. Twenty minutes of work, plus however long your DNS takes
to propagate. #457 chose Mailgun because it is the one inbound service that
receives on a free plan; #461 settled that the address sits on a subdomain of a
domain you already own.

**1. Pick the subdomain.** `in.example.com`, say. A subdomain rather than the
domain itself: the MX records below say where mail for that name goes, and on
the root name they would take your own email with them.

**2. Add it to Mailgun.** Domains → Add New Domain, with the subdomain as the
name. Mailgun then shows the DNS records for that domain, which are the
authority on the exact values — the table below is what they look like.

**3. Put the records in your DNS.**

| Type | Name | Value | Why |
|---|---|---|---|
| MX | `in.example.com` | `mxa.mailgun.org`, priority 10 | Where mail for the subdomain is delivered. |
| MX | `in.example.com` | `mxb.mailgun.org`, priority 10 | The second one. Both, or delivery has one place to fail. |
| TXT | `in.example.com` | `v=spf1 include:mailgun.org ~all` | SPF. Some publishers check the domain before they will send to it. |
| TXT | `<selector>._domainkey.in.example.com` | the key Mailgun shows | DKIM, for the same reason. The selector is Mailgun's. |

Verification takes minutes to a few hours. Mailgun's domain page says whether it
has seen them.

**The MX records are the ones that get missed.** Mailgun's DNS page lists the
*sending* records (SPF, DKIM, and a `email.` CNAME for tracking) in one block
and the two *receiving* MX records in another, and a domain with the first
block and not the second looks verified, passes a spot check, and takes no mail
whatever. Nothing in this app can see it: the address renders, the settings
page is happy, and every message sent to it bounces at the sender before
Mailgun is ever involved. That is exactly what happened here on
`in.selveyknight.com` — SPF, DKIM and the CNAME all present, no MX at all, two
newsletter signups and a test message lost to it.

So check the MX explicitly, not the green tick:

```bash
dig +short MX in.example.com
# must print two lines: mxa.mailgun.org and mxb.mailgun.org
```

An empty answer means no mail can ever arrive, no matter what the rest of this
section says.

**4. Point the mail at the app.** Receiving → Routes → Create Route. Expression
`catch_all()`, actions `forward("https://<your app>/api/news/inbound")` and
`stop()`, priority 0. Every message sent to the domain is then posted to that
endpoint, whatever the local part — which is what lets an address be replaced
without touching Mailgun. Mail addressed to a local part nobody owns is dropped
there with a 200 and no bounce, so a stranger cannot learn which addresses
exist.

**5. Copy the signing key.** Sending → Webhooks, where Mailgun keeps the HTTP
webhook signing key. Not the API key. Every post to the endpoint is checked
against it — timestamp and token, HMAC-SHA256 — and a post that does not match
is answered 401 and stored nowhere.

**6. Set the two variables** in the Vercel project settings, and in `.env.local`
for a local run:

```
NEWS_MAIL_DOMAIN=in.example.com
MAILGUN_SIGNING_KEY=<the signing key>
```

Both are optional. With neither set the app builds and runs, and it says so
rather than pretending: News settings names whichever of the two is missing,
the News page says "Nothing can arrive yet" instead of inviting you to sign up
for something, and the inbound endpoint refuses everything that reaches it.
Setting the domain without the key is the one combination that used to look
healthy — an address on the page, a promise under it, and a 500 on every
delivery. `lib/news/inbound/readiness.ts` is what closed that.

**7. Send it something.** Open News settings, copy the address, and mail it from
anywhere. It appears in News within a minute. If it does not, Mailgun's Logs
show whether the message reached the route and what the endpoint answered.

**8. For sending, add the API key.** Only unsubscribing needs it. Some
publishers put an address in the List-Unsubscribe header rather than a link,
and the app writes to that address from your own newsletter address
(`lib/news/unsubscribe/send.ts`). Sending needs two things the receiving half
does not. One is a sending key, which Mailgun keeps under Send → API keys and
which is a different value from the signing key in step 5; set
`MAILGUN_API_KEY` to it. The other is the SPF and DKIM records from step 2,
verified, since a publisher's mail server checks them before it trusts mail
claiming to come from your domain. With the key unset, unsubscribing from an
address-only newsletter says the deployment cannot send, and everything else
in News works as before.

The sender posts to `api.mailgun.net`. A domain created in Mailgun's EU region
answers 401 there and needs `api.eu.mailgun.net` instead, which is a change to
`MAILGUN_API_BASE` in that file rather than a variable.

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

The newsletter workspace adds three of its own, all optional:

| Variable | What it is | Where it comes from |
|---|---|---|
| `NEWS_MAIL_DOMAIN` | The domain Mailgun receives newsletters on, e.g. `in.example.com`. Every account's address is a random local part on it. | You choose it, in step 1 above. |
| `MAILGUN_SIGNING_KEY` | The HTTP webhook signing key every inbound post is checked against. Not the API key. | Mailgun, Sending → Webhooks. |
| `MAILGUN_API_KEY` | The sending key, used only to send the unsubscribe mail a publisher asked for by address. Not the signing key. | Mailgun, Send → API keys. |

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

### eBay marketplace account deletion (required)

eBay marks an application **Non Compliant** unless it either receives
marketplace account deletion notifications or claims an exemption, and
restricts the production keyset until it is resolved — which looks from the
outside like credentials that stopped working, not like a policy flag.

This app never sees an eBay user: it authenticates with client credentials and
stores one price per ISBN, no usernames or item ids. So either route is honest.
The endpoint is already built, so it is the one that needs no review:

1. Generate a token — `openssl rand -hex 24` — and set `EBAY_VERIFICATION_TOKEN`
   in Vercel. It must be 32–80 characters of `A-Za-z0-9_-`.
2. Redeploy, so the running deployment can answer.
3. In the developer portal, under **Alerts & Notifications → Marketplace Account
   Deletion**, enter the same token and the endpoint
   `https://<NEXT_PUBLIC_APP_URL>/api/ebay/account-deletion`, then save.

eBay immediately GETs the endpoint with a `challenge_code` and expects the
SHA-256 of `challengeCode + verificationToken + endpointURL`, in that order. The
endpoint in that hash must be byte-identical to the one registered, which is
what nearly every failed validation turns out to be — set
`EBAY_DELETION_ENDPOINT_URL` if the registered URL is not the app's own.

The notification itself is answered with 204 and nothing is erased, because
nothing about an eBay user is held. The alternative, if you would rather hold no
endpoint at all, is the exemption: same screen, slide **Not persisting eBay
data** to On and submit a reason.

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

`vercel.json` schedules one job, `/api/cron/daily` at 12:00 UTC. It runs its
stages in order: the inbox sync — one pass over the mailbox, offered to both
workspaces — then the job sweep that re-derives ghosted status and generates
reminders, the JD backfill, the vault sync, the plan's claim sweep, and the
dev digest. The claim sweep puts a plan step whose session died back to not
started; it is before the digest so the morning summary reports the corrected
rows.

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

### The overnight tick — two Vault secrets you must add by hand

The overnight runner needs a second, much more frequent clock:
`/api/cron/overnight` looks at what the runner is doing and, if the last
feature it fired has finished, fires the next one. Once a day is useless for
that, and sub-daily cron on Vercel needs Pro — so this one clock lives in the
database instead. `supabase/migrations/0078_overnight_tick_cron.sql` enables
`pg_cron` and `pg_net` (both already available on the project, both free) and
schedules a job named `overnight-tick` that POSTs to the route **every four
minutes**, in UTC, which is the timezone Supabase runs its databases in.

The job cannot know the origin to post to or the secret to post with — those
are deployment facts, and the secret must never be in the repository — so it
reads both out of Supabase Vault every time it fires. **Until you add them, the
job runs on schedule and posts nowhere.** Applying the migration warns when
they are missing; nothing else will tell you.

In the Supabase dashboard, **Project Settings → Vault → Add new secret**, twice.
The names are exact — the job looks them up by name:

| Name | What it holds |
|---|---|
| `app_origin` | The deployed origin of this app: scheme and host, no trailing slash, no path — e.g. `https://your-app.vercel.app` |
| `cron_secret` | The exact value of `CRON_SECRET` in the Vercel environment (or of `TOKEN_ENCRYPTION_KEY` if `CRON_SECRET` is unset, since that is the fallback the routes accept) |

In order: set `CRON_SECRET` in Vercel and deploy, then add the two secrets to
Vault, then apply the migration (`npx supabase db push`) — or apply it first and
add the secrets after, which also works; the job re-reads Vault on every tick,
so rotating the secret or moving the deployment needs no second migration.

To check it afterwards:

```sql
select jobname, schedule, active from cron.job where jobname = 'overnight-tick';
select id, status_code, error_msg, created
  from net._http_response order by created desc limit 5;
```

(`pg_net` keeps those replies for a few hours and then drops them, so look the
morning after, not the week after.)

A `200` there is a tick that ran. A `401` means `cron_secret` does not match
`CRON_SECRET` — which is also the protection this route has instead of a login,
since anything on the internet can reach it.

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

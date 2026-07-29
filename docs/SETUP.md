# Setup

Almost everything here is automated. The exceptions are the things that need a
browser, a human clicking consent, or a credit card. Those are listed below,
tier by tier, in the order you actually need them.

**You do not need most of this to start.** Only Tier 0 is required, and it takes
about fifteen minutes. Google Cloud is not needed until build step 10, which is
most of the way through the project. Do not front-load it.

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

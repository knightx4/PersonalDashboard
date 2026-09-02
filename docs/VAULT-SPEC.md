# Vault

A third workspace: your Obsidian vault, synced into the app and readable inside
it. v1 is a viewer and nothing more. It is specified in full here because what
it is *for* only makes sense at the end, and the shape of v1 is chosen to make
that end cheap rather than to make v1 impressive.

## Why a vault at all

Every other source this app has needs a habit. Gmail was the exception — mail
accumulates whether or not the app exists, which is why it was the first source
and why the commerce side works at all.

A vault is the second thing with that property. You already write in Obsidian,
for your own reasons, and you would keep doing it if this workspace were deleted
tomorrow. Nothing about ingesting it asks you to log, tag, rate or remember
anything. That is the whole argument, and it is a strong one: the failure mode
of personal-insight tools is that they need feeding, and this one does not.

### What it is authoritative for

Not orders, not inventory, not applications. Those are facts, the database holds
them, and prose is worse at them.

The vault is authoritative for **you** — voice, judgment, preferences, the
stories you would tell in an interview, the reasons you gave yourself for
decisions. Right now nothing in either schema knows what you *want*; both only
know what happened. That gap is what the vault closes, and it is the reason a
later agent can decide rather than merely list.

Keep the vault non-authoritative over transactional data and the whole feature
stays safe. Let it overrule an order record and it becomes a liability.

## Non-goals

Listing these because they will otherwise get invented.

- **Not an editor.** The app never writes to the vault. Obsidian is the only
  writer, the vault is the master copy, and sync is one-way, always. If app-authored
  notes ever happen they go in an `outbox/` folder the app owns exclusively, and
  that is a separate decision, not this one.
- **No attachments.** Markdown only. Images, PDFs, audio and canvas files are
  never fetched, never stored, never transferred. See "Only `.md`" below — this
  is enforced at the transport layer, not by filtering after download.
- **No semantic search, no embeddings, no pgvector in v1.** The extension is not
  installed and this spec does not install it. Postgres full-text is enough for
  a viewer and defers a real decision until there is a real consumer.
- **No graph view, no canvas, no plugins, no Dataview queries.** Obsidian renders
  those; this does not compete with Obsidian.
- **No sharing.** Same as the rest of the app: one user's view of their own data,
  RLS on every row.
- **No LLM pass over vault content in v1.** Nothing is sent to Anthropic. This
  keeps the privacy posture unchanged while the viewer proves itself, and makes
  the later decision an explicit one.

## The rule this module is built to obey

Two commits already decided the philosophy and this module inherits it:

- `ca9501c` — *Make the review flag mean "you have to decide this."* A queue item
  that is not a real decision is a tax.
- `fd33268` — *Write the follow-up, not just the reminder to send one.*
  `lib/jobs/followup/compose.ts` puts it plainly: knowing a pursuit has gone
  quiet is the easy half; the blank compose window is the half that decides
  whether anything happens.

So: **the vault never generates a queue.** There will be no "312 notes to
review," no confirm step, no tagging UI, no "is this still true?" prompt. When
the vault eventually feeds the writing layer, confirmation happens at the point
of use — approving a draft that cited a passage is what promotes that passage,
and you were going to edit that draft anyway. See "What this unlocks" below.

The cost of that choice is that failures are silent, and the mitigation is not a
queue: it is that every vault-derived sentence carries the note and line it came
from, so rejecting a wrong one costs one keystroke in the place you were already
looking.

## What the human does

Once, about twenty minutes, and then never again.

1. **Make the vault a git repo.** Private GitHub repo, `git init` in the vault,
   push. Install the **Obsidian Git** community plugin and set auto-commit-and-push
   on an interval; hourly is plenty.
2. **Generate a fine-grained PAT**, `Contents: Read-only`, scoped to that one
   repository. Paste it into `/vault/settings`.
3. **Apply the migration** to Supabase, per [SETUP.md](SETUP.md) → Migrations.

There is **no new environment variable.** The PAT is per-user, stored encrypted
with the existing `TOKEN_ENCRYPTION_KEY` through `lib/crypto/tokens.ts`, exactly
as Gmail refresh tokens already are.

Gitignoring attachments in the vault is **optional**. It halves the repo and
speeds up the human's own pushes, but the app never requests a non-`.md` blob,
so leaving them in costs the app nothing.

### Why git and not an upload, a folder picker, or Drive

- **Upload / folder picker.** Zero setup, but recurring: every refresh is a
  manual act, which is the admin work this module exists to avoid.
- **Obsidian Sync / iCloud.** No usable API.
- **Google Drive.** Tempting because the Google OAuth plumbing already exists,
  and wrong: Drive scopes are *restricted*, and this app is heading for CASA
  verification under a lifetime 100-user cap (see [consent-tally.md](consent-tally.md)).
  Widening the Google grant to carry a note viewer is a bad trade.
- **Git.** ~20 minutes of one-time setup, then genuinely zero. It also hands us
  incremental sync for free: a commit SHA is a perfect cursor, the compare API
  gives changed paths, and blob SHAs give content-level dedup with no hashing of
  our own. It is the same shape as `email_accounts.sync_cursor`, so the pattern
  is already in the codebase.

The one real cost: Obsidian Git does not work well on iOS. Mobile edits land
whenever a desktop next opens the vault. Acceptable for v1.

## Schema

A fourth schema, `vault`, alongside `public` (shopping), `job_search`, and
`core` (ingestion). It gets its own schema for the same reason the other two do:
it is a separate domain with its own lifecycle, and nothing in it belongs to
either existing workspace.

Migrations live in `supabase/migrations-vault/`, numbered from `0001`, and the
directory is added to the loop in `scripts/db-reset.sh` after `migrations-job-search`.

> **Note.** `vault` does *not* go under `core`. `core` is for facts that arrive
> on a shared sync and that neither workspace owns — an order confirmation and a
> rejection letter on the same Gmail pull. The vault has exactly one consumer
> today and its own transport. Putting it in `core` would claim a generality it
> has not earned.

### `vault.vault_connections`

One row per user. Mirrors `core.email_accounts` closely enough that the reauth
banner, status enum and settings panel are near-copies.

| Column | Notes |
|---|---|
| `id`, `user_id` | `references auth.users(id) on delete cascade` |
| `provider` | enum, `'github'` only for now — the column exists so a second source is a value, not a migration |
| `repo_owner`, `repo_name`, `branch` | branch defaults to the repo's default |
| `subpath` | optional, when the vault is a subdirectory of the repo |
| `access_token` | encrypted at rest, never returned to the client |
| `token_expires_at` | fine-grained PATs expire; see reauth below |
| `sync_cursor` | last successfully synced commit SHA |
| `status` | `active \| needs_reauth \| disconnected \| error` |
| `last_synced_at`, `created_at`, `updated_at` | |

Unique on `(user_id)` — one vault per user in v1. The uniqueness is on the user
rather than the repo so lifting the restriction later is a dropped index.

### `vault.notes`

| Column | Notes |
|---|---|
| `id`, `user_id` | |
| `path` | repo-relative, `.md` included. Unique per user |
| `title` | frontmatter `title`, else first H1, else filename stem |
| `body` | the markdown, frontmatter stripped |
| `frontmatter` | `jsonb`, `'{}'` when absent |
| `blob_sha` | git's own blob SHA. Content dedup for free — unchanged blob, no fetch |
| `size_bytes` | |
| `git_updated_at` | commit time of the last change to this path |
| `deleted_at` | soft delete, nullable |
| `created_at`, `updated_at` | |

Indexes: unique `(user_id, path)`; `(user_id, git_updated_at desc)` for the list;
a generated `tsvector` over `title || body` with GIN for search; `gin_trgm_ops`
on `title` for fuzzy title match, matching how the job side indexes `questions.text`.

A per-note cap of 1 MB. Anything larger is skipped and recorded on the sync run
rather than failing it — one pathological note must not stop a vault.

**Deletes are soft.** If Obsidian Git ever pushes a bad commit that drops files,
the sync faithfully deletes those notes, and the app must never be the reason
something is gone. Rows are hidden, not removed; a later commit restoring the
path revives the row and its id.

**Renames preserve identity.** The compare API reports renames with
`previous_filename`, so the row keeps its id and only `path` changes. This costs
nothing now and matters a great deal later, when a note is cited by an evidence
item and a rename must not orphan the citation.

### `vault.sync_runs`

`core.sync_jobs` with the vault's counters: `type` (`backfill | incremental`),
`status`, `notes_seen`, `notes_written`, `notes_deleted`, `notes_skipped`,
`from_sha`, `to_sha`, `error`, timestamps. Same 207-style partial-success
reporting as `/api/cron/daily`.

### RLS

Every table, no exceptions, from the first migration. The cross-user isolation
test in `tests/` gets the three new tables added to its list **before any feature
code is written** — build step 2's rule, which exists precisely so a missing
policy surfaces immediately rather than months later.

`vault.notes` and `vault.vault_connections` must also be added to the cascade in
`app/api/account/delete/route.ts` when build step 15 lands.

## Transport

All GitHub access lives behind `lib/vault/providers/github.ts`, and **nothing
outside `lib/vault/providers/` imports a GitHub client** — the same containment
rule as `lib/email/providers/`, enforced the same way. A local-folder or GitLab
source later costs one file and no changes anywhere else.

### Only `.md`

The filter happens **before any content is requested**, which is what makes the
"no attachments" non-goal real rather than aspirational:

```
GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1
  → entries; keep type === 'blob' && path.endsWith('.md') && !path.startsWith('.')
  → then, and only then, fetch those blobs
```

A photo's bytes never cross the network, never reach the server, and never reach
Postgres. This is also why the tarball endpoint is rejected despite being one
request instead of thousands: it would transfer the entire vault, attachments
included, to filter afterwards.

`.obsidian/` and any dotfile directory are excluded — plugin config is not a note.

### Backfill

The tree call gives every markdown path in one request; the blobs are then
fetched in batches. A 3,000-note vault is ~3,000 requests against a 5,000/hour
PAT limit, which fits, but not with room to spare and not inside one function
invocation.

So backfill reuses the existing pump: `lib/core/inbox/pump-budget.ts` and
`resume.ts` already solve "do as much as the 300-second budget allows, record
where you stopped, hand off to a continuation." The vault is a second caller of
machinery that is already load-bearing, not a second implementation of it.

If the tree response comes back `truncated: true` (100k entries or 7 MB), fall
back to a per-directory walk. Rare, but silent truncation would mean silently
missing notes, which is worse than slow.

### Incremental

```
GET /repos/{owner}/{repo}/compare/{sync_cursor}...{head_sha}
  → files[] with status: added | modified | removed | renamed
```

Filter to `.md`, apply, then set `sync_cursor = head_sha`. Unchanged `blob_sha`
means no fetch at all, so a typical daily run costs one compare call and a
handful of blobs.

Two fallbacks, both of which must exist because both are silent failures
otherwise:

- **Compare returns more than 300 files** (3,000 paginated). Fall back to a full
  tree diff against stored `blob_sha`s.
- **Cursor SHA no longer exists** — history rewritten, or force-pushed. Compare
  404s. Fall back to a full tree diff, which converges on the same state. This is
  the direct analogue of the expired-`historyId` catch-up already built for Gmail.

### Reauth

Fine-grained PATs expire. A 401 sets `status = 'needs_reauth'` and surfaces the
same banner shape as an `invalid_grant` Gmail account. The app must never silently
stop syncing — a vault that quietly went stale six weeks ago is worse than one
that says so.

### Schedule

A third stage on `/api/cron/daily`, after `inbox` and `jobs-sweep`. Stages are
isolated there by design, so a vault failure is reported and the commerce sync
still runs. Order is not significant — nothing in v1 reads the vault — but last
is the honest place for the newest and least proven stage.

## The viewer

`app/vault/`, and a third entry in `WORKSPACES` in
`components/shell/workspace-switcher.tsx` so it sits alongside Shopping and Job
search. Same shell, same design system, same `PageHeader` and `EmptyState`.

| Route | |
|---|---|
| `/vault` | notes, grouped by folder, newest first. Search over title and body. |
| `/vault/n/[...path]` | one note, rendered. |
| `/vault/settings` | connect, disconnect, sync now, last-synced, note count. |

`/vault` before connection is an `EmptyState` pointing at `/vault/settings`, in
the shape the other workspaces already use for a missing Gmail grant.

### Rendering

Three dependencies: `react-markdown`, `remark-gfm`, `gray-matter`.

**`rehype-raw` is deliberately not among them.** With raw HTML disabled,
`react-markdown` will not render embedded HTML at all, and that is the sanitizer.
It matters more than it looks: Obsidian web-clipper notes routinely contain
arbitrary HTML from whatever page they clipped, and this is your own vault
rendering under your own session — the one place where "it is only my data" is
not a defence, because the data came from the open web.

External links get `target="_blank"` and `rel="noopener noreferrer"`.

Frontmatter is parsed out with `gray-matter`, stored as `jsonb`, and displayed as
a small properties strip above the note — not dumped into the body as a code
fence, which is what a naive renderer does and what makes Obsidian notes look
broken on the web.

### Obsidian-specific syntax

| Syntax | Treatment |
|---|---|
| `[[Note]]`, `[[Note\|alias]]`, `[[Note#Heading]]` | resolved by basename against `vault.notes`; links to `/vault/n/<path>`. Ambiguous → first match. Unresolved → plain text, muted, not a dead link |
| `![[image.png]]` | a muted "attachment not synced" placeholder. Honest, and by design — those bytes were never fetched |
| `![[Note]]` (note embed) | rendered as a link in v1, not inlined. Transclusion is a recursion problem and v1 does not need it |
| `#tag` | plain text in v1. Frontmatter `tags` are shown in the properties strip |
| `%%comment%%` | stripped |
| Callouts (`> [!note]`) | render as plain blockquotes in v1 |

A small remark plugin handles wikilinks and embeds; everything else is one
regex pass before render, and both are unit-tested against a fixture note that
contains all of the above.

## Security and privacy

- The PAT is read-only, scoped to one repository, encrypted at rest, and never
  returned to a client. Same handling as Gmail refresh tokens.
- RLS on all three tables; the isolation test extended before feature code.
- No raw HTML rendering, as above.
- **No vault content is sent to any LLM in v1.** Worth stating explicitly, and
  worth revisiting explicitly rather than by drift: a vault plausibly contains
  journals, health notes, and things about other people who did not consent to
  being in anyone's training-adjacent pipeline. The privacy policy currently
  describes mail ingestion only, and it must be updated **before** the first
  vault-content model call, not after.
- Vault sync involves no Google scope and no change to the CASA position.

## What this unlocks (not v1)

Recorded so the v1 shape is legible, and so none of it gets built early.

**The writing layer.** `evidence_items` is the quality ceiling for every draft
the app produces — its own migration comment says no prompt engineering
compensates for an empty bank — and it is currently hand-fed. Vault passages
retrieved at draft time and cited inline would fill it, and the promotion rule is
the one from the section above: approving an `application_answer` that cited a
passage is what turns that passage into a real evidence item. The mechanism
already exists in `application_answers.evidence_item_ids`. No queue is ever
created.

**Attaching to what already exists.** `job_search.notes` takes exactly one parent
from five (company, role, application, contact, interview). A vault note about a
company can surface on that company's page without any new table.

**Preferences, which is the actual prize.** "I'm done with commuting," "I regret
buying this," "I don't want another role where I'm the only one who cares about
X." `cooldown_until` and the pipeline can act on those, and nothing else in
either schema can supply them.

Each of those needs retrieval, which needs the pgvector decision. That decision
is deferred deliberately and should be made when the first real consumer exists,
not before.

## Open questions

- **Scope.** v1 syncs every `.md` in the repo. A folder allowlist or a
  frontmatter opt-in is the obvious refinement, and it should wait for a real
  reason — the whole vault is the simpler default and the one the human asked
  for. Revisit when something *reads* the vault rather than displays it.
- **Vault size in practice.** Markdown compresses well and 50 MB of it is
  unremarkable for Postgres, but the row count and the first backfill's wall
  clock are both guesses until measured against the real vault.
- **Daily is probably too slow, eventually.** A webhook on push is the obvious
  upgrade and costs a public HMAC-authenticated route, of which there are already
  two. Not v1: nothing reads the vault yet, so freshness buys nothing.
- **One vault per user.** Fine now. Multiple vaults means dropping a unique index
  and adding a picker, and that is cheap by construction.
- **Contradiction over time.** A note from 2019 and one from 2025 can disagree,
  and the 2019 one is not wrong, it is *former*. Recency will have to be a
  first-class retrieval signal. Irrelevant to a viewer; central to everything
  after it.

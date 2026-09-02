# The evidence layer

This replaces what `docs/JOB-SEARCH-SPEC.md` calls "Phase 2, the writing
layer". The rename is not cosmetic. Two different things in this repo were
called Phase 2 — the job side's writing layer and the shopping side's
anti-spending layer (`docs/BUILD-ORDER.md` step 19) — and a note in the UI
saying "in Phase 2" told the reader nothing about which. This document owns
the job-side work under a name, and `BUILD-ORDER.md` step 19 keeps the number.

The substance changed too. The spec's Phase 2 was written before the app had
users, before the two workspaces merged, and before `/jobs/today` existed. Some
of its list has quietly shipped, some of it has been settled the other way on
purpose, and the part that is genuinely undone is smaller and better defined
than the list suggests.

---

## What is actually there now

The spec is eighteen months of drift out of date in the places that matter to
this work.

**One deployment, three schemas.** The job tracker was specced as its own app
fetching its own mail. It is a workspace inside this one: `public` for
commerce, `job_search` for the job side, `core` for ingestion, one login, one
Supabase project. Migration `migrations-job-search/0006_ingestion_to_core.sql`
dropped the job side's own `email_accounts`, `sync_jobs` and
`ingested_messages` — those three tables never held a row.

**No pgvector.** The spec assumed embeddings over questions, evidence and
requirements. The extension was never installed; `pgcrypto` and `pg_trgm` are
what exist. Nothing in the app has ever computed an embedding. Any matching
built now is lexical or model-driven, and at the size of one person's evidence
bank that is the right answer anyway — see slice 2.

**`/jobs/today` exists and is the daily driver.** Not in the spec at all. Four
questions, each section empty when there is nothing to say. It is where a new
surface earns its place or does not.

**Real volume.** 341 pursuits, 203 of them dead, after six months. This is the
single most important fact for planning: a feature whose cost is *per pursuit*
is a feature you will run a few dozen times at most, on the ones you are
actually deciding about. Anything that assumes you will draft prose for every
row is built for an app that is not this one.

**Model calls are already normal here, in one specific shape.**
`lib/jobs/enrich/ai-company.ts` is the house pattern: a model constant at the
top of the file, tool-use for structured output, the payload parser split into
its own module (`ai-company-payload.ts`) so it is testable without a network
call, and Zod at the boundary. `lib/jobs/inbox/tier-b.ts` is the same shape for
classification. Copy this, do not invent a second style.

**The follow-up is a template, deliberately.** `lib/jobs/followup/compose.ts`
fills the compose window with a deterministic template and says why in its
header: instant, free, the same every time, readable in full and disagreeable
with — "and the text is going out over your name, which is the wrong place to
be surprised." The spec listed outreach drafting as a generation feature. The
app has already answered that question, and the answer is binding on this plan.

**The development loop is note-driven.** Feedback goes into `feedback_items`
from inside the app, and each note becomes one commit (`docs/NOTES-WORKFLOW.md`;
see the last thirty commits). The plan below is therefore a sequence of
commit-sized slices, not four big pieces of work.

### The spec's Phase 2 list, scored

| Spec item | Reality |
|---|---|
| Canonical answer promotion flow | **Shipped.** `promoteToCanonical` in the role page's Answers panel; a repeat question auto-fills from the canonical answer. |
| Follow-up reminders on rules | **Shipped.** `inngest/jobs/cron/sweep.ts` raises them nightly, `/jobs/today` shows them. |
| Outreach message drafting | **Settled the other way.** `lib/jobs/followup/compose.ts` is a template and should stay one. |
| Requirement mapping on the role page | **Half.** Requirements are extracted and rendered; nothing matches evidence to them. |
| Answer generation with evidence grounding | Not built. |
| Cover letter generation | Not built. `cover_letters` has no code touching it at all. |
| The shareable application page | Not built. No `app/jobs/p/[slug]`. |
| Browser extension replacing the bookmarklet | Not built, and out of scope — see below. |

### The dead columns

Written in the MVP so that this work would need no migration. Still unread by
any line of code:

- `application_answers.evidence_item_ids`, `.unsupported_claims`
- `cover_letters` — the whole table
- `profiles.writing_style_notes`, `.banned_constructions`
- `resume_versions.text_content`

The claim in `JOB-SEARCH-SPEC.md:35` that this phase needs no migration is now
false — slice 2 needs one — but it is nearly true, and most of the storage
below already exists.

---

## What the evidence layer is

**Every line of a job description gets your record beside it, and everything
downstream is a citation of that.**

The reframe from "the writing layer" is the point. The spec's phase was
organized around producing prose. This one is organized around the join —
requirement to evidence — because that join is what the app uniquely knows and
a chat window does not, and because it pays off *before* you apply, not only
while you are writing. Knowing that four of six must-haves are gaps saves the
hour. Prose that hides the gaps costs it.

So the layer is built bottom-up: fill the bank, compute the match, show the
gaps, and only then use the match to draft — with citations visible and the
draft never landing in the box unasked.

**The one decision this plan asks you to make** is how far past the match to
go, and it is deferrable: slices 1–3 are the evidence layer proper and stand
on their own. Slices 4–5 are drafting, and they are where the compose.ts
precedent has to be honoured rather than quietly overridden. Read them and
decide when you get there; nothing earlier depends on the answer.

---

## Constraints this inherits

- **Migrations are the schema.** Nothing clicked into a dashboard. A new
  `job_search` table must also be added to `seedEverything()` in
  `tests/rls-jobs.test.ts` or the coverage assertion fails — by design.
- **Next job-side migration number is `0014`.** The two directories are
  numbered independently; see `scripts/db-reset.sh`.
- **Zod at every boundary, model output included.** Never gate on the model's
  self-reported confidence alone.
- **An empty evidence set is an error, not an empty-context fallback.** The
  spec's rule; keep it.
- **Confirm before write, for anything a model proposed.** The commerce side
  already does this for shelf photos and receipts. Same rule here.
- **Split the parser from the network call**, as `ai-company-payload.ts` does,
  so the interesting half is unit-testable.
- **Model.** Write `claude-opus-5` for the matching call — it is a judgment
  task and the volume is low. The repo currently uses `claude-haiku-4-5` for
  company lookup, where the job is retrieval, not judgment. Rough cost for a
  match: ~8K in / ~1.5K out per role is about $0.08 on Opus 5, under $0.02 on
  Haiku 4.5. Downgrading is a fine call to make later, on evidence; it is
  yours, not the implementation's.
- **Cache the bank, not the role.** The evidence bank is identical across every
  role you match. Put it in the system block with `cache_control`, put the
  role's requirements last in `messages`, and repeat matches read the bank from
  cache at about a tenth the price. Check `usage.cache_read_input_tokens` is
  non-zero on the second call — if it is zero, something volatile leaked into
  the prefix.

---

## The plan

Six slices. Each is a commit or three, in this order, because each one is
useless without the one above it.

### 1. Fill the bank

**Why first.** The Settings copy already says it: "the quality ceiling of every
draft this app will ever write is set here." The bank is also, almost certainly,
empty — the only way in is a six-field form that adds one item at a time, and
nobody sits down and does that twenty times. Every slice below multiplies by
this number. If it stays at zero they are all worth zero.

**What.** Seed the bank from material that already exists in the account:

- `resume_versions.text_content` — the column exists for exactly this and is
  never read. Paste or upload a resume, split it, propose each accomplishment
  bullet as a candidate item.
- `application_answers` where `status = 'approved'` and the question is
  behavioural — an approved behavioural answer *is* a story, already in your
  own words.
- `interviews.notes` — the debriefs, same argument.

One model call per source, tool-use, returning candidates shaped like the
`evidence_items` columns (`title`, `body`, `context`, `metrics`, `skills`).
Render them as a confirm list. **Nothing is inserted without a click** — this is
the shelf-photo rule, and it matters more here because a bad item silently
poisons every match downstream.

**Files.** `lib/jobs/evidence/propose.ts` + `propose-payload.ts` (new),
`app/jobs/(app)/settings/evidence-actions.ts` (extend),
`app/jobs/(app)/settings/view.tsx` (the Evidence bank section, ~line 572).

**Done when** pasting one resume takes the counter past twenty and the
"N short of a useful bank" warning clears.

### 2. The match

**What.** For a role with requirements and a non-empty bank, produce for each
requirement line: the best evidence item, a verdict of `strong` / `partial` /
`gap`, and one line saying why.

**How, cheap half first** — the same instinct as `requirements.ts`, which is
heuristic on purpose:

1. **Shortlist, free.** Per requirement, rank evidence by `pg_trgm` similarity
   over `title || body` plus overlap with `skills[]`. Take the top handful.
   Union them across requirements — for a 25-item bank this is usually most of
   the bank, which is fine; the shortlist exists so the call stays bounded as
   the bank grows.
2. **Judge, one call per role.** Send the whole requirement list and the
   shortlisted items in a single request and get the whole map back. Not one
   call per requirement — that is fifteen calls where one will do, and it also
   denies the model the ability to spread your evidence across lines instead of
   citing the same story six times. Say that in the prompt explicitly.

**Storage.** Migration `0014_requirement_matches.sql`: `roles.requirement_matches
jsonb`, `requirement_matches_at timestamptz`, and `requirement_matches_key text`
— a hash of `jd_hash` plus a fingerprint of the bank. The key is what makes this
re-run when the JD or the bank changes and stay put otherwise; without it a
model call fires on every page view. Add a `gin (title gin_trgm_ops)` index on
`evidence_items` in the same migration.

**Files.** `lib/jobs/evidence/shortlist.ts`, `lib/jobs/evidence/match.ts` +
`match-payload.ts` (new), `app/jobs/(app)/roles/[id]/actions.ts`,
`app/jobs/(app)/roles/[id]/panels.tsx` (the Requirement map, ~line 436 — and
delete the "In Phase 2" note that started all this).

**Done when** the Requirement map shows evidence beside each line, matching is
triggered explicitly rather than on render, and a second visit costs nothing.

### 3. The number, where you decide

**Why.** This is where the layer stops being a panel you visit and starts
changing behaviour. "4 of 6 must-haves covered" on the role header, and on the
pipeline row, is the thing that stops you spending an hour on a role you cannot
credibly claim — which is the same job `/jobs/today` does for time and the
review queue does for trust.

**What.** Derive the count in `lib/jobs/pipeline.ts` — funnel and derivation
maths lives there and nowhere else, and the ESLint rule in
`tests/lint-boundaries.test.ts` enforces it. Surface it on the role header,
the pipeline row, and as a rail filter ("has gaps"). No new model calls: it is
arithmetic over slice 2's output.

**Done when** you can sort the board by coverage and the top of that list is
where you actually work.

### 4. Answer drafting, cited

*The first slice past the match. Decide whether you want it before building it.*

**What.** On an unanswered question with a matched role, offer a draft. It
arrives **beside** the textarea, not in it, with its citations listed under it
and an Insert button — the compose.ts principle carried forward: the model may
prepare text, but nothing goes out over your name that you did not put there.

Reuses four dead columns and adds none: `evidence_item_ids` records what it
cited, `unsupported_claims` records what it could not ground and shows as a
warning, `profiles.writing_style_notes` goes into the prompt,
`profiles.banned_constructions` is a hard post-check that strips or flags
(seeded with em dashes and "passionate about" — the check is a regex over the
output, not an instruction in the prompt, because instructions leak).

Empty evidence set → refuse with a message pointing at the bank. Not a
generic draft.

**Done when** an answer can be drafted, every sentence traces to an item you
can click, and the ungrounded claims are called out rather than smoothed over.

### 5. The case page

**What.** The spec's shareable application page: a public URL rendering the
requirement map with your evidence beside each line and a short statement of
interest. Reuse `cover_letters` rather than adding a table — it already has
`body`, `evidence_item_ids`, `public_slug` and `public_expires_at`, and it is
otherwise dead. Drop standalone cover letter generation entirely; this is what
the table is for.

**The security work is the work.** This would be the only unauthenticated
surface in the entire app, in a database whose every table is RLS-protected and
whose isolation test exists to keep it that way. Before any UI: the read path
is a `security definer` function returning one row by slug and checking
expiry — not a service-role client, not an RLS exemption — `noindex` headers, a
slug with real entropy, and a case in `tests/rls-jobs.test.ts` proving an
expired or wrong slug returns nothing. Get that right and the page itself is an
afternoon.

**Done when** a link renders the map for one application, expires on schedule,
and the RLS test proves the negative cases.

### 6. Retire the phase language

Sweep the eleven `Phase 2` references out of code comments, migrations and the
spec, pointing them here or deleting them where the thing has shipped. Update
`JOB-SEARCH-SPEC.md:35` — the no-migration claim is no longer true. Small, and
worth doing last, when the names have settled.

---

## Out of scope, on purpose

- **Outreach generation.** Settled by `lib/jobs/followup/compose.ts`. If the
  template is wrong for a case, fix the template.
- **Cover letters as their own artifact.** Folded into slice 5.
- **The browser extension.** The bookmarklet works and costs one click. An
  extension is a store listing, a review cycle and a permissions prompt — a
  distribution problem wearing a feature's clothes.
- **pgvector.** Revisit if the bank passes roughly 200 items. At 25, lexical
  shortlisting plus one model call is both cheaper and more accurate than an
  embedding index, and it is one less extension to keep alive.

## Open questions

- **Does the match re-run when the bank changes?** `requirement_matches_key`
  makes it possible; whether stale matches on 203 dead pursuits are worth
  recomputing is a product call. Suggest: recompute lazily, on visit, and only
  for non-terminal statuses.
- **Should a gap be actionable?** A `gap` verdict is the app telling you to go
  get that experience, or to write the item you forgot you had. "Add evidence
  for this" beside a gap line is a cheap addition to slice 2 and might be the
  most valuable button on the page.
- **Where does coverage live on `/jobs/today`?** Probably a fifth question —
  "worth applying to" — but the page's discipline is that a section earns its
  place. Build slice 3 first and see whether the number wants to be there.

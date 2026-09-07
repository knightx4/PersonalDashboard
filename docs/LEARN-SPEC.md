# Learn

A fifth workspace. v1 does one thing: it takes a list of things somebody told
you to read and turns it into a queue you can actually start — each item
resolved to a real link, pointed at the part that matters, and tracked at that
level rather than at the level of the whole book.

Everything else the module is eventually for is in "Where this goes" at the
end, and none of it is v1.

## The problem, precisely

The recommendation is not the bottleneck. Ask any decent model what to read
about a question you are stuck on and it gives you five good answers. The one
that prompted this module was about price and value, and the reply was Sen,
Walzer, Dworkin, Hayek and Weyl. That is a genuinely good list.

Then nothing happens, for two reasons.

**The list is names, not links.** "Dworkin's 'Equality of Resources'" is a
citation. Finding it means a search, a judgement about which PDF is the real
one, and a decision about whether the paywalled version is worth it. Five
times. That is twenty minutes of admin standing between you and the first
page, and it is the reason the list gets copied into a note and never opened
again.

**The list is whole works.** *Spheres of Justice* is 350 pages. You are not
going to read *Spheres of Justice*. What you needed was chapter 4, "Money and
Commodities", which is thirty-five pages and is the part that argues the thing
you were actually confused about — that the problem is money's universal
convertibility rather than its unequal distribution.

Both of those are mechanical. Neither is hard for a machine. Neither is done
by anything you currently use.

Resolving that same five-item list took four searches: Sen, Hayek and Dworkin
all have free full text, Walzer resolves to a named chapter, and Weyl is free.
Four of five openable, one located. That measurement is the whole basis for
this module existing.

## What this is not

Listing these because they will otherwise get invented, and because two of
them were in the first draft of this document and were cut for cause.

- **Not a curriculum generator.** Not in v1. Generating twenty units from a
  bare topic was tested before this spec was written and it is the expensive,
  unreliable half: it needs twenty-plus searches, it silently leaves holes
  (a generated history of Singapore covered 1819–1826 and 1942–1965 and simply
  omitted the rest, without saying so), and its quality tracks whether the
  topic has a free canonical corpus rather than anything about the prompt.
  Resolution is the reliable half. Ship the reliable half first and let
  generation inherit a proven queue rather than the other way round.
- **Not a summarizer.** The module never replaces a source with its own prose
  about the source. This is the single easiest way for this to become the
  thing it was built in opposition to. Revisit deliberately, with rules, once
  the queue works. See "Where this goes".
- **Not a reader.** The app does not render other people's documents. It sends
  you to them, as close to the right paragraph as the format allows.
- **No vault coupling.** v1 does not read `obsidian` and nothing in `obsidian`
  changes. The vault link is real and is slice 5.
- **No MCP.** v1 has a paste box. The connector is slice 3, and it is a
  transport change to an engine that has to exist either way.
- **No sharing, no social, no gamification.** Same as every other workspace.

## The rule this module is built to obey

**Never send someone to a page that is not there.**

The entire premise is the removal of friction. A pointer that is confidently
wrong — a chapter number the model produced from memory, a PDF link that
404s, a paper that turns out to be in Spanish — costs more than no pointer at
all, because you spend the twenty minutes anyway *and* you stop trusting the
queue. One of those three happened during the test that justified this spec:
a search for VAE tutorials surfaced an arXiv paper with an English title whose
body is in Spanish, and nothing in the snippet said so.

So every reading carries a **confidence** and a **basis**, and the interface
shows both. A verified locator means something was fetched and checked. An
unverified one says so on the card, in words, before you click. The module is
allowed to guess; it is not allowed to guess quietly.

The second rule follows from the first: **the app stores locations, not
texts.** For a work it did not pay for and you do not own, it keeps the
citation, the page or chapter, a short anchor phrase, and whatever you write
yourself. It never keeps the body. This is not only a copyright position —
a stored copy also goes stale, and a link into the live document does not.

## Where it sits

`learn`, the fifth module. `/learn` routes, `lib/learn/`, and a `learn`
Postgres schema.

The schema name is free — unlike `vault`, which collided with Supabase's own
secrets store and had to become `obsidian`. `learn` is not among the schemas a
hosted Supabase project ships (`auth`, `storage`, `graphql`, `realtime`,
`extensions`, `vault`, `net`, `cron`, `pgbouncer`), so it can be called what it
is. `coexistence.test.ts` should assert that as it does for the others, rather
than trusting this paragraph.

Migrations live in `supabase/migrations-learn/`, numbered from `0001`, and the
directory joins the loop in `scripts/db-reset.sh` after `migrations-todo`.

A fifth entry in `MODULES` in `lib/modules.ts` gets it into the switcher and
onto `/home` in one edit, which is what that list exists for.

- `id: 'learn'`, `prefix: '/learn'`, `home: '/learn'`
- Accent: the four existing hues are stops on one sweep — todo at sky
  (`#036695`), jobs at violet (`#7c3aed`), vault at fuchsia (`#a21caf`),
  shopping at rose (`#be1250`). A fifth belongs at the cold end, before todo:
  teal, around `#0f766e` light and `#5eead4` dark. Run `npm run check:contrast`
  before committing to it — the number here is a proposal, not a measurement.
- Mark: a new `MarkShape`, `'stack'` — three thick horizontal bars. It obeys
  the solid-silhouette constraint, it is unmistakable against `page` at 16px,
  and it is a picture of what the module holds: a pile of things to get
  through.

## The nouns

Four tables. The shape of them is the one real design decision in this
document, so the reasoning is written down.

### `learn.sources`

A work. One row per thing-that-exists-in-the-world, deduped for the user:
Hayek's essay shows up in three different reading lists and is one row.

| Column | Notes |
|---|---|
| `id`, `user_id` | `references auth.users(id) on delete cascade` |
| `title`, `author` | canonical, as resolved — not as pasted |
| `kind` | enum: `article \| paper \| book \| chapter \| video \| course \| page` |
| `year` | nullable int |
| `canonical_url` | the best openable address, null when nothing free was found |
| `access` | enum: `open \| paywalled \| purchase \| library \| unknown` |
| `price_cents` | nullable, when `purchase` and a price was seen |
| `access_checked_at` | nullable; access decays, and a stale check should look stale |
| `page_count`, `duration_seconds` | nullable, whichever applies |
| `created_at`, `updated_at` | |

`access` is a first-class column rather than a derived guess because the
honest curriculum for a paywalled canon is "buy this one thing, then these six
are free," and a module that cannot say that will silently route you to worse
free material instead. That failure was observed in testing: the two canonical
Porter articles are $10 each behind HBR, and every free substitute is worse.
Hiding that is the kinnu failure mode.

### `learn.readings`

**The unit, and the thing progress is tracked on.** A reading is not a source.
A reading is a *located slice* of a source — "ch. 4, pp. 95–128" — plus the
reason it is in your queue.

| Column | Notes |
|---|---|
| `id`, `user_id`, `track_id`, `source_id` | |
| `position` | int, order within the track |
| `locator_kind` | enum: `whole \| chapter \| section \| pages \| timestamp \| passage` |
| `locator_label` | human text: `Ch. 4, "Money and Commodities"` |
| `page_from`, `page_to` | nullable ints |
| `open_url` | where the button goes: base URL, `…#page=12`, or a text-fragment URL |
| `text_anchor` | the phrase the fragment matches on; nullable; short |
| `locator_confidence` | enum: `verified \| unverified` |
| `locator_basis` | how it was established, in words. Rendered, not hidden |
| `why` | one line: what this gives you that the previous reading did not |
| `status` | enum: `queued \| reading \| read \| abandoned` |
| `note` | what you took from it. Free text, yours |
| `started_at`, `finished_at` | |
| `created_at`, `updated_at` | |

`abandoned` is a real status and not a tidying convenience. A queue that can
only be completed is a queue that lies about your progress, and the bars on
`/learn` are worthless the moment they include six things you gave up on in
March.

`why` is written at resolve time and is the one sentence that makes an
ordered list a curriculum rather than a bibliography. It says what the reading
adds, not what the reading contains.

**Deliberately not a join table.** The same slice of the same source can
appear in two tracks, and in v1 that is two rows. A `track_readings` join
would make "have I read this?" a global fact instead of a per-track one, which
is where this ends up — but that generality has not been earned by a second
track existing yet, and the migration to add it later is additive. Until then
the app can answer the question with a query over `(source_id, page_from,
page_to)` and show "you read this in *Value and price*, March" on the card.
That is the whole benefit, at no schema cost.

### `learn.tracks`

An ordered queue with a reason for existing.

| Column | Notes |
|---|---|
| `id`, `user_id` | |
| `title` | "Value and price" |
| `question` | nullable, and the more important field — the thing you were actually stuck on, in your words |
| `status` | enum: `active \| done \| shelved` |
| `created_at`, `updated_at` | |

`question` is nullable but it is the field this module is really built around.
The reason the price-and-value list was good is that the question behind it was
specific: *price is supposed to quantify value but it only reports an
equilibrium, and the equilibrium is relative to how much money you started
with.* A topic name — "philosophy of value" — would have produced a worse list.
It is also what the locate pass targets: "find the part of this that speaks to
*that*" is a much better instruction than "find the important part."

### `learn.imports`

Provenance. One row per paste.

| Column | Notes |
|---|---|
| `id`, `user_id`, `track_id` | |
| `raw_text` | what you pasted, verbatim |
| `source_hint` | free text: `claude`, `chatgpt`, `a friend`, null |
| `parsed` | `jsonb`, the candidate list the parse produced |
| `created_at` | |

Kept because six weeks later "why is this in my queue?" is a real question,
and because when the parser gets something wrong the only way to see how is to
still have the input. Cheap, small, and the alternative is guessing.

### RLS

Every table, no exceptions, in the first migration. `tests/rls-learn.test.ts`
and the addition of all four tables to the cross-user isolation list happen
**before any feature code is written** — build step 2's rule, which exists so a
missing policy fails immediately rather than in a year.

Account deletion needs no route change: everything cascades from
`auth.users`. `rls-learn.test.ts` asserts that rather than assuming it.

## The flow

### 1. Intake — `/learn/new`

Two fields and no ceremony.

- **What are you trying to work out?** — free text, optional, becomes
  `tracks.question`.
- **Paste what you were told to read** — a textarea. The five-bullet reply
  from a chat, a syllabus, a footnote, a friend's text message. Anything.

Either field alone is enough. Question with no paste is slice 4's territory
and for now says so. Paste with no question works fine and is the common case.

### 2. Parse

Free text to candidate references. Same shape as `lib/books/paste-list.ts`,
which already does exactly this job for a pasted list of owned books and is
the pattern to copy rather than reinvent: Haiku
(`claude-haiku-4-5-20251001`), a tool call, a `zod` schema, and a
line-heuristic fallback when `ANTHROPIC_API_KEY` is unset so the module is
developable without one.

Out: `{ title, author?, kind_hint?, raw_line, why_hint? }[]`, capped at 40.

The parse deliberately does not search. It only reads what is in front of it.
Splitting parse from resolve keeps the cheap step cheap and makes the
expensive step retryable per row.

### 3. Resolve

Per candidate, and this is where the module earns its keep. One call with
the server-side search tool (`web_search_20260209`, as
`lib/sell/web-estimate.ts` already uses it), bounded to a handful of searches,
run through `mapPool` from `lib/async/map-pool.ts` at low concurrency.

It answers four questions:

1. **What is this, canonically?** Title, author, year, kind. "Dworkin's
   'Equality of Resources'" is *What is Equality? Part 2: Equality of
   Resources*, Dworkin, 1981 — and Part 1 exists and sets up the argument,
   which is worth surfacing.
2. **Where can I open it?** Prefer free and legitimate: a publisher, a
   university host, an author's page, an institutional repository. Reject
   summary sites, "book summary" apps, and content farms outright — they are
   the exact thing this module exists to bypass.
3. **What is the access?** Open, paywalled with a price, purchase, or library.
   Recorded, not hidden.
4. **Which part?** A proposed locator with a basis. For a famous work the
   model often knows this from memory; that answer is accepted only as
   `unverified` unless step 4 below confirms it.

Nothing is written yet.

### 4. Confirm — the one click

A list of what was found, each row showing title, author, access, the proposed
locator and its confidence. You untick the junk and save.

This is a queue, and this document is otherwise sympathetic to the vault
spec's rule that queues are a tax. It is here for the reason `EVIDENCE-LAYER.md`
gives for its own confirm list, which is the stronger argument: a bad item
does not merely sit there, it poisons everything downstream. A wrong source
in a reading queue is twenty wasted minutes at the exact moment you were
finally about to read something. It also matches the shelf-photo, receipt and
paste-list flows on the commerce side, all of which propose and none of which
write.

One screen, one click, and then never again for that track.

### 5. Locate — lazily, on open

**Not at resolve time.** When you open a reading whose locator is unverified
or whose anchor is missing, the app fetches the document then and there,
finds the passage, writes back `open_url`, `text_anchor`, `locator_confidence`
and `locator_basis`, and takes you there.

Lazy because you will not read most of what you queue, and reading a 62-page
Dworkin PDF to find a paragraph you never asked for is money spent on
optimism. Cost should track what you study, not what you filed.

Verification, by format:

- **HTML.** Fetch, extract readable text, ask a cheap model for the passage
  that answers `tracks.question`, then **confirm the returned phrase appears
  verbatim in the fetched text.** If it does, build a text-fragment URL —
  `…#:~:text=<phrase>` — and mark `verified`. Browsers scroll to it and
  highlight it, which means nothing is copied, nothing goes stale, and you
  land on the source rather than on a paraphrase of it. If the phrase is not
  found verbatim, the model invented it: discard and fall back.
- **PDF.** `#page=N` opens most browser viewers at the page, which is enough
  for v1 and needs no new dependency. Page-level only. Passage-level
  extraction needs a PDF text library and is slice 2 — the line is drawn here
  because HTML anchoring is free and PDF anchoring is a dependency plus a
  week of column-and-ligature misery.
- **Book or paywalled.** Nothing is fetched. A chapter claim is `verified`
  only if a table of contents was found — publisher page, Google Books,
  archive.org — that contains the named chapter. Otherwise `unverified`, and
  the card says "likely ch. 4, unconfirmed."
- **Video.** `?t=<seconds>`, verified against a transcript when one is
  available, unverified otherwise.

`locator_basis` records which of these happened, in a sentence, and it is
rendered on the reading page. "Found in the fetched page" and "the model
believes this, unchecked" are different claims and the interface must not
flatten them.

### 6. Read, and say so

`/learn/r/[id]` is the reading: the locator, its basis, a large **Open** button,
your note, and three buttons — reading, read, gave up.

The note is the point. It is one field, it is optional, and it is the first
thing in this application that records something you learned rather than
something you did. Everything in "Where this goes" about knowing what you know
starts as a pile of these.

## Fetching other people's URLs, safely

Every other integration in this app talks to a fixed host — GitHub, Gmail,
eBay, BGG. This one fetches addresses that came out of a model that read text
a stranger wrote. That is a server-side request forgery surface and it is new
to the codebase, so it gets stated rather than assumed:

- `https` only. No `http`, no `file`, no `data`, no anything else.
- Resolve the host and refuse private, loopback, link-local and
  metadata-service ranges — before the connection, and again on every redirect.
- Cap redirects, and re-check the host on each one.
- Hard timeout, hard response-size cap, and an allowlist of content types
  (`text/html`, `application/pdf`, `text/plain`). Anything else is dropped
  unread.
- No cookies, no credentials, no auth headers, ever.

All of it lives behind `lib/learn/providers/`, and **nothing outside that
directory fetches an external URL** — the same containment rule
`lib/vault/providers/` and `lib/email/providers/` already obey, enforced the
same way, with a case added to `tests/lint-boundaries.test.ts` alongside the
existing vault-provider boundary.

## Routes

| Route | |
|---|---|
| `/learn` | tracks, with progress. `EmptyState` pointing at `/learn/new` when there are none |
| `/learn/new` | question + paste, then the confirm list |
| `/learn/t/[id]` | one track: the question at the top, then ordered readings |
| `/learn/r/[id]` | one reading: locator, basis, open, note, status |

Same shell, same design system, same `PageHeader` and `EmptyState` as the
other four.

Progress on `/learn` counts `read` over `read + queued + reading`, with
`abandoned` excluded from both. A bar that fills when you give up is a lie,
and a bar that is permanently short because of one abandoned paper in March
is a nag.

## Cost, measured rather than assumed

Per import of a five-item list: one cheap parse, five resolve calls with a
handful of searches each. Tens of cents, once, at the moment you asked for it.

Per open: one fetch and one cheap locate call, only for readings you actually
open.

Both are user-initiated and neither is on a cron. That is deliberate — nothing
in this module runs in the background in v1, so there is no budget to manage
and no `pump-budget.ts` involvement. Speculative resolution of things you might
one day want is exactly the sort of spend that makes a personal tool cost real
money for no benefit.

## Open questions

- **Text fragments in practice.** Supported across current Chrome, Edge,
  Safari and Firefox, but they fail silently on pages that changed since the
  anchor was captured, and they do not work at all inside some PDF and reader
  views. Worth measuring how often a saved anchor still lands correctly a month
  later before leaning on it harder.
- **How aggressive should source rejection be?** Rejecting content farms is
  clearly right. Rejecting all secondary literature is clearly wrong — a good
  explainer of Dworkin is sometimes the correct first reading and the primary
  paper the second. The rule is unwritten and should be written from real
  rejections rather than in advance.
- **Chapter granularity for books.** "Ch. 4" is useful. "Ch. 4, and really
  only pp. 95–110" is much more useful and is generally unverifiable without
  the book. Live with the coarser answer, or find an edition-aware source of
  page ranges.
- **Re-resolution.** Links rot. Nothing in v1 re-checks a `canonical_url` or
  an `access` value after the day it was written. A slow background sweep is
  the obvious fix and is deferred until something has actually rotted.

---

# Where this goes

Sketches. Recorded so v1's shape is legible and so none of it gets built
early. Each slice assumes the one before it worked.

**Slice 2 — PDF passages.** A PDF text library, so a paper gets the same
passage-level landing an HTML page already gets. One dependency and a week of
extraction misery. Worth it only once page-level pointers have proven
insufficient in practice.

**Slice 3 — the MCP connector.** A remote MCP server on this app, added as a
custom connector in Claude, so "add those to my learn queue" works mid
conversation. The engine is identical to the paste box's; this is transport
and OAuth. Fifteen seconds saved per use, which is worth a week only after the
engine is something you use.

**Slice 4 — generation from a question.** A track from a question with no
paste — the app plays the role the chat played. Deferred until last among the
sourcing slices because testing showed generation is the weak half: expensive,
gap-prone, and quietly incomplete. When it lands it must state what it could
not find sources for, because a plausible list with a century missing is worse
than a short honest one.

**Slice 5 — the vault link, at last.** Structure derived from `obsidian.notes`
without touching them: materialize the wikilinks into an edge table, keyed on
`blob_sha` so it re-derives when a note changes and never fights the one-way
sync. That buys backlinks and orphans in the vault itself, pays off the
checkbox source the todo module deferred, and — the reason it is here — turns
every unresolved `[[wikilink]]` into a candidate track. An unresolved link is a
gap you declared yourself: you named the idea and never wrote it down. That
list is a reading queue you have been writing for years without knowing it.

**Slice 6 — what you already know, told directly.** Education, transcripts,
syllabi, essays and homework, a written-up account of work you cannot paste.
Structured input to the same store the reading notes land in. This is where
the module stops being a queue and starts being a model of you, and it is also
where it stops being cheap — parsing a transcript into concepts is real work
and the value only appears once something reads it.

**Slice 7 — suggestion rooted in what you know.** The pitch: never bored by
the basics, never dropped into something you are not ready for. It needs
slices 5 and 6 to have produced enough signal to be right more often than a
guess, and it should be honest that early on it will not be.

**Slice 8 — summarization, if ever.** The only version worth building is one
that cannot make anything up: every sentence anchored to a passage in the
source, with the passage one click away, and no orphan claims. If that
constraint cannot be enforced mechanically, it does not ship — an unanchored
summary is the slop this module was built in opposition to, and shipping it
would make the whole thing indistinguishable from what already exists.

**The notes question, still open.** The broader plan wants notes atomic but
not rigid, connected in more than one direction, and talkable-to. Slice 5's
edge table is the honest first inch of that and no more. What an "atom" is,
whether it is derived or authored, and whether a concept is a row or a
clustering — none of that is decided, and it should be decided against a real
vault after slice 5, not in this document.

**Job search.** `job_search` already has an evidence layer built around things
you can demonstrate. A reading queue and a set of notes about what you learned
is a different claim about yourself and plausibly feeds the same drafting. Not
a slice, just a place these two will meet.

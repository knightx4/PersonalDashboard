# Learn: where to go learn it

A catalogue of places to learn from, mapped against the subjects and claims
already in the graph, and addressable down to a single clip of a single video.
Wikipedia, Khan Academy, and a set of lecture channels on YouTube to start with,
with room for more.

This sits beside [LEARN-SPEC.md](LEARN-SPEC.md), which answers "where do I read
this" for a source you already named. That document assumes you bring the
source. This one supplies them, and adds the one thing a vault-derived graph
cannot produce on its own: material about parts of a subject you never wrote a
note about.

It depends on [LEARN-GRAPH-SPEC.md](LEARN-GRAPH-SPEC.md) for what a concept is
and on [LEARN-MAP-SPEC.md](LEARN-MAP-SPEC.md) for centrality and the six edge
types. It changes neither.

Written to [WRITING-GUIDE.md](WRITING-GUIDE.md).

---

> **One premise under this document has changed since it was written.**
> [KNOWLEDGE-SPEC.md](KNOWLEDGE-SPEC.md) now holds the foundation, and it moves
> the map of the vault out of the learn graph entirely: the map belongs to the
> vault, records what its owner writes about rather than what they know, and the
> learn graph starts empty and fills a goal at a time.
>
> Nothing built here is wrong because of it. The catalogue, the segment as the
> unit, the retrieval-then-verdict pass and the ranking rules all stand
> unchanged, and the sentence above about supplying "material about parts of a
> subject you never wrote a note about" is more true rather than less.
>
> What is genuinely open is what `catalogue_links` should point at. A link
> targets a concept or a subject today. On the new model the graph is the
> sparser of the two stores for a long while, and the vault map holds roughly
> two thousand positions from its first sweep. That decision is recorded in the
> foundation's open questions and wants settling before the verdict pass writes
> links at volume, since re-targeting them means running it again.

## What the schema already anticipated

Most of the shape needed here was designed in `0001_learn_schema.sql` and never
used:

- `source_kind` already has `video` and `course`.
- `locator_kind` already has `timestamp`.
- `sources` already carries `duration_seconds` beside `page_count`.
- `source_access` already distinguishes `open` from paywalled, and every source
  named in this document is `open`.
- `tracks` plus `readings` ordered by `position`, each with a `why` saying what
  it gives you that the previous one did not, is already a curriculum. The
  comment on that column says so.

Three things are missing, and they are the whole of this feature:

1. **The catalogue itself.** There is nowhere to put a work you have not
   queued. `sources` holds works you have a relationship with.
2. **Time offsets on a reading.** `locator_kind` can say `timestamp`, and
   `readings` has `page_from` and `page_to` with no equivalent for seconds. A
   timestamped reading can currently only be expressed by hiding `?t=` inside
   `open_url`, which cannot be rendered as `12:04–18:30` and cannot be measured.
3. **Any way to find a segment.** Nothing in the module can answer "which of
   these forty thousand things speaks to this claim".

---

## The catalogue is not a source

`learn.sources` is per-user, deduped per user, and described in its own header
as a work that exists in the world with nothing in it about your relationship to
that work. The temptation is to put the catalogue there. That is wrong for one
reason: a catalogue of forty thousand Wikipedia articles is not forty thousand
rows per account, and the moment there are two accounts it is eighty thousand.

So the catalogue is separate, and shared. It carries no `user_id`, no RLS keyed
to a person, and nothing about anybody's progress.

Queuing materialises a `sources` row from a catalogue entry. Every existing
foreign key, every page that reads `readings`, and the whole locate pass keep
working with no change, because what they see is a `sources` row exactly as
before. The catalogue is what you search and recommend from; `sources` stays the
record of what you decided to engage with.

This also means a catalogue entry can be corrected or re-ingested without
touching anybody's queue, and deleting a catalogue row cannot orphan a reading.

---

## A segment is the unit

The most useful thing in the ContextLab mapper design is that a video is not one
point. They embed sliding windows of each transcript, 512 words with a 50-word
stride, so an eighty-minute lecture occupies a path across their map rather than
a single position.

That solves the problem this feature would otherwise have. Offering a whole MIT
lecture as the answer to one claim is close to useless, because the claim is
covered in four minutes somewhere in the middle and finding it is the work. It
is also what the brief asks for directly: set it to a specific clip.

So the addressable row is a **segment**, and a segment is what gets recommended,
what gets mapped to a concept, and what becomes a reading:

| item kind | a segment is | what it carries |
| --- | --- | --- |
| video | a contiguous span of the transcript | `t_start_seconds`, `t_end_seconds` |
| article | one section | the section anchor |
| course | one unit in the published order | its position, and the item it points at |

A segment carries its own embedding. An item does not, because nothing ranks a
whole eighty-minute lecture against a Wikipedia section and nothing needs to.

Segment boundaries for video follow the transcript, snapped to sentence ends,
with a target length of roughly three to six minutes and an overlap of about
thirty seconds so a claim explained across a boundary is not lost by both
neighbours. Where the source publishes chapter markers, those are the boundaries
instead, because a human already decided where the seams are.

---

## Tables

Same rules as the rest of `learn`: composite foreign keys carrying `user_id`
wherever a row belongs to a person. The catalogue tables are the exception and
belong to nobody.

| table | holds |
| --- | --- |
| `catalogue_providers` | one row per place material comes from: Wikipedia, a named YouTube channel, Khan Academy. Name, kind, home URL, licence, how it is ingested, when it was last swept |
| `catalogue_items` | one work: title, provider, external id, canonical URL, duration or length, publication date, and the licence it came under |
| `catalogue_segments` | the addressable unit above: item, ordinal, time offsets or section anchor, the text it covers, and its embedding |
| `catalogue_links` | a segment speaks to a concept or a subject: target, basis, confidence, and the model and date that decided it |
| `catalogue_judgements` | every segment the judge read for a claim, accepted or refused: target, similarity, length in characters, verdict, and the press it came from |
| `catalogue_course_items` | the published order of a course: which items belong to it, in what position, under the provider's own numbering |

A course is not a table of its own. It is a `catalogue_items` row of kind
`course`, which is a value `source_kind` has carried unused since 0001, and
`catalogue_course_items` orders its members underneath it. One fewer table, and
a course gets segments and links like anything else.

`catalogue_providers` is a table rather than an enum because the brief says
"ones I want to add later". An enum would make adding a channel a migration.

`catalogue_links` carries a `basis` and a `confidence` for the same reason
`readings.locator_basis` is `not null`: a link established by cosine similarity
and a link a model read the transcript and defended are different claims, and a
screen that renders them identically is overstating one of them. The values
mirror `locator_confidence`: `verified` means a model read the segment text and
argued for the link, `unverified` means it is a nearest neighbour and nothing
more.

Two changes to existing tables:

- `readings` gains `t_start_seconds` and `t_end_seconds`, with the same shape of
  check constraint `page_from`/`page_to` already has, and a constraint that they
  are present when `locator_kind` is `timestamp` and absent otherwise. This is
  the gap the enum has been advertising since 0001.
- `sources` gains a nullable `catalogue_item_id`, so a materialised source knows
  where it came from and a second queue of the same lecture collapses onto one
  row.

`pgvector` is new to this database. It goes in `extensions`, like `pg_trgm`, and
the segment embedding column is the only thing that uses it.

---

## How a segment reaches a claim

Two stages, in the order the module already uses on the reading side: the model
proposes and the code checks.

**Retrieval.** Nearest segments to a concept's `claim`, by embedding. This is
candidate generation and nothing else. Forty candidates, cheap, no model call.

**Verdict.** One call per candidate that matters, given the claim and the
segment text, answering whether this segment teaches this claim and writing the
sentence that becomes `why`. Refusal is an ordinary outcome and most candidates
should be refused; a retrieval layer that returns forty neighbours for every
claim will return forty for a claim nothing in the catalogue covers.

A link is never written on similarity alone. That is `locator_basis` applied to a
new surface, and the reason is the same one given there: a link that highlights
nothing is worse than no link, because you spend the twenty minutes anyway and
then stop trusting the queue.

Nothing runs this over the whole catalogue against the whole graph. It runs for
one concept when something asks for material about that concept, and the result
is stored, so the second ask is free.

---

## Courses are the part worth taking

A search engine can find a video about a claim. What these providers have that a
search engine does not is **published order**. MIT OpenCourseWare, Khan
Academy's unit structure and the Yale open courses all ship a sequence somebody
competent argued about.

That sequence is worth two separate things:

**A track skeleton.** A course maps directly onto the structure that already
exists: a `track` whose `readings` are the units in the provider's order, each
with a `why`. The ordering comes free and is better than a generated one.

**A prerequisite prior.** LEARN-MAP-SPEC names cross-note edge extraction as its
open risk, because most real edges are between concepts that never appeared on
the same page. A course syllabus is an expert's answer to exactly that question,
stated as an order. Lecture 7 coming after lecture 4 is weak evidence for
`requires` and strong evidence that they belong in the same neighbourhood, which
is what the extraction pass needs to narrow its candidates.

Weak evidence, treated as such. A syllabus order reflects a term's worth of
scheduling as much as it reflects logical dependency, so an imported order
proposes `requires` edges and never writes one. It goes through the same
approval screen as every other way into the graph, and the acyclicity trigger
still has final say.

---

## What to recommend

The brief leaves this open. The recommendation is to not build a ranker.

**Rank within a claim, not across the catalogue.** `/learn/next` already decides
the one next thing worth learning, from the graph, with no model call. Once that
is decided, the catalogue answers a much smaller question: of the segments linked
to this claim, which one to open. That needs no learned weights and no training
data, and it is the version that works on the first day the catalogue exists.

Ordering inside a claim, in this order of precedence:

1. **Rung fit.** What you need depends on what has been shown. `recognise` wants
   an article section or a short talk. `applied` wants a lecture that works an
   example. `defend` wants something that argues a position rather than
   explaining a consensus. This is the largest term and it is a lookup, not a
   score.
2. **Not already consumed**, and not abandoned.
3. **Length fit.** A four-minute segment and a fifty-minute lecture are
   different commitments, and the session already knows which it is offering.
4. **Link confidence**, then similarity, as the tiebreak.

**Why not the mapper approach.** Their recommender ranks 5,400 videos by
observed transfer: snapshot the knowledge estimate, re-probe, accumulate the
per-region delta into a running average, then rank by what has historically
taught you. It is the right design for their data volume and the wrong one here.
A transfer estimate over the few dozen things one person will get through is
noise with a number attached, and a number that looks like evidence and is not
is worse than an ordering that admits it is a lookup.

What is worth taking from it is the per-item verdict rather than the ranking:
whether *that* segment moved *that* claim, which is answerable at one
observation and is the earlier reading-verdict proposal.

**What to record now.** Consistent with the rule on `/learn/next`, nothing
records that a segment was offered or shown. What is recorded is what you did on
purpose: opened it, finished it, abandoned it, and what a later probe on the
linked claim showed. That is also exactly the record a better ranker would need
if there is ever enough of it.

---

## The providers, honestly

Acquisition differs per provider, and this is the main risk in the feature. It
is not uniform and pretending otherwise would put the hard part in the last
week.

| provider | metadata | text or transcript | licence |
| --- | --- | --- | --- |
| Wikipedia | REST API, no key | same API, full section text | CC BY-SA |
| YouTube channels | Data API v3, needs a key | see below | per channel |
| MIT OpenCourseWare | its own site, per course | transcripts published on ocw.mit.edu | CC BY-NC-SA |
| Yale open courses | oyc.yale.edu | transcripts published per lecture | CC BY-NC-SA |
| TED | ted.com | transcripts published per talk | TED's own terms |
| Khan Academy | see below | see below | CC BY-NC-SA |

**Wikipedia is the easy one** and should be built first for that reason. No key,
a documented API, clean section structure that gives segment boundaries with no
transcript work at all.

**YouTube captions are the problem.** `captions.download` requires an OAuth
token from an account that owns the video, and returns 403 for anything else. It
exists so creators can fix subtitles on their own uploads, and downloading
captions from third-party videos was never part of it. The endpoint that public
transcript libraries use instead is an internal one, undocumented, with no
stability guarantee and outside the API's terms.

The way around it is that the institutions publish their own transcripts. OCW,
Yale and TED all do, on their own sites, under licences that permit this. So
take metadata and playlist order from the YouTube API and take text from the
institution.

**Enumerate playlists, do not search.** `search.list` costs 100 quota units per
call against a 10,000-unit daily default, which is a hundred calls a day and
makes search-driven ingest impossible. `playlistItems.list` costs 1. Every
channel here organises its lectures into playlists, usually one per course, so
walking playlists is both cheaper by two orders of magnitude and gives the
published order that the courses section depends on.

That leaves channels with no published transcripts, where the honest answer is
that only title and description are available, and a segment cannot be cut. Such
an item is catalogued at item granularity with one segment covering the whole
thing, and it competes poorly on length fit, which is correct.

**Khan Academy has no supported public API.** The v1 REST API was withdrawn in
2020, independent developers cannot get credentials, the API host answers 403,
and no developer programme replaced it. Most of the video content is on the Khan
Academy YouTube channel, so it comes in through the YouTube path rather than a
bespoke scraper. The unit structure, which is the part actually worth having, has
to come from the site and is the one place a fragile scrape may be justified. It
is also deferrable: Wikipedia plus OCW plus Yale is already a usable catalogue.

All fetching goes through `lib/learn/providers/`. That containment is enforced by
eslint and proved by `tests/lint-boundaries.test.ts`, and the SSRF checks in
`fetch.ts` apply to every hop. A sweep that pulls thousands of URLs is exactly
the traffic that rule was written for.

---

## What this does not do

**No 2D map and no Gaussian process.** The mapper projection needs a joint UMAP
and density flattening on a GPU cluster, and its output discards the six edge
types the graph is built on. The embedding here is a retrieval index, and it
never becomes a coordinate system.

**No search yet**, per the brief. Nothing is wasted by deferring it: search over
this catalogue is the same segment embedding with a typed query instead of a
claim, so it is a route rather than a new system.

**No feed.** There is no page that lists what to watch next across every
subject. The catalogue answers questions asked from a claim or a subject, and a
ranked global list is the thing that would need the transfer data this design
declines to fake.

---

## Secrets

Two values cannot be determined from here.

- **A YouTube Data API v3 key**, for metadata and playlist order. Free tier,
  10,000 quota units a day, which is comfortable for a nightly sweep and tight
  for a first full ingest. Goes in the environment as `YOUTUBE_API_KEY`.
- **An embedding provider key.** See the decision below for which.

Wikipedia, OCW, Yale and TED need no credential.

---

## Decisions to make

**Which embedding model.** Settled at the schema level and still open at the
provider level. The column is `vector(1024)`, which both candidates can emit:
Voyage natively, and OpenAI's small model through its `dimensions` parameter. So
the provider choice no longer blocks anything, and every segment stores the model
that embedded it, which makes a half-re-embedded catalogue detectable rather than
silently wrong. A hosted API either way, because there is no GPU in this
deployment and there is not going to be one.

**How much to ingest first.** Ingesting all of Wikipedia is pointless here. The
useful scope is the reference set per subject already proposed for coverage,
which is on the order of a hundred articles per subject rather than a hundred
thousand.

**Whether an article segment is a section or a window.** Sections are free and
respect the author's structure. Windows are uniform and better for retrieval on
long articles with bad headings. Start with sections, since the retrieval layer
can be changed without touching what a reading points at.

---

## Build order

1. ~~`pgvector`, the five catalogue tables, and the two changes to `readings`
   and `sources`.~~ Applied as `learn_0022_catalogue`. The `timestamp` locator
   columns were worth having regardless of everything below, and a reading can
   now say `12:04–18:30` and be measured.
2. Wikipedia ingest for one subject, at section granularity. No key, no
   transcripts, and it proves the retrieval and verdict passes end to end.
3. The verdict pass and `catalogue_links`, with the approval screen.
4. Ordering within a claim, and the route that answers "material for this
   claim".
5. YouTube metadata plus OCW transcripts for one course. This is where the
   per-provider work actually starts.
6. Courses as track skeletons, and the `requires` prior as proposals.
7. Khan Academy, last, and only if the unit structure proves worth the scrape.

Steps 1 and 2 are a working feature on their own: material about parts of a
subject your notes never covered, which is the thing the graph could not do
before.

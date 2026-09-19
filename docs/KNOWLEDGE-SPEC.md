# Knowledge: the record, and the map over it

The foundation the learn and vault modules both stand on. Four documents
already describe parts of this and each was written from inside one part:
[VAULT-SPEC.md](VAULT-SPEC.md) mirrors the notes, [LEARN-SPEC.md](LEARN-SPEC.md)
queues the reading, [LEARN-GRAPH-SPEC.md](LEARN-GRAPH-SPEC.md) probes what you
know, and [LEARN-MAP-SPEC.md](LEARN-MAP-SPEC.md) works out how a map is built
from notes that were never written to be mapped.

They disagree with each other and with the database in eight places, listed at
the end. This document settles those, and it owns the two decisions none of
them could make alone: where the graph lives relative to the notes, and what
sits above them.

Written to [WRITING-GUIDE.md](WRITING-GUIDE.md).

---

## What is being built

A store of everything you think about the things you are interested in, and a
map over it that knows the difference between what you have written down, what
you hold, and what you have been shown to know.

Two jobs come out of that, and they behave differently enough that treating
them as one thing is the mistake to avoid.

**Knowing what you know.** Tangible, testable, and settled by evidence. A
question was asked, you answered, the answer was right or wrong. This is the
half where the app is allowed to assert something about you.

**Organising what you have written.** Categorising, breaking down, assessing,
connecting. Judgement calls with no correct answer, made mostly by a model
reading your prose, and wrong often enough that any design which cannot be
corrected in one tap is the wrong design.

Both read the same store, at two different confidences, and one column holds
the line between them: everything the organising half
produces lands at `claimed`, and only an answer you gave can move it past
that. A map that credits you with knowing four hundred things because you once
saved an article is worse than no map, because it is wrong in the exact place
you would rely on it.

---

## The record, and the graph over it

The vault is the record. The graph is a layer on top of it and never writes
into it. Obsidian stays the only writer, the sync stays one-way, and the app
holds a mirror of the notes plus everything it derives from them.

The vault earns the role on a property nothing else in the account has. It
accumulates whether or not this app exists, it is plain text with two decades
of history behind the format, and you would keep writing in it if the app were
deleted tomorrow. Nothing the graph does should put that at risk, and the
cheapest way to guarantee it is to have no write path at all. The stored PAT is
`Contents: Read-only` and `lib/vault/providers/github.ts` has no method that
writes, so this is a property of the code rather than a rule somebody has to
remember.

### What that costs, said plainly

An atom arrives in one of four ways, and they do not all survive the same
accidents.

| how an atom arrives | where it lives | recoverable from the vault |
|---|---|---|
| extracted from a note you wrote | a row, pointing at the note and the sentence | yes, by re-running the sweep |
| generated as scaffolding for a goal's chain | a row | yes, by regenerating |
| you typed it into the app | a row, and only a row | **no** |
| you rewrote a generated claim in your own words | a row, and only a row | **no** |

The first two are derived and cost a few dollars of model time to rebuild. The
last two are writing you did, and they exist in exactly one place.

That is the real price of not writing back, and it is worth paying, because the
alternative is a process holding commit access to the one body of writing in
your life that currently has no automated writer. The mitigation is much smaller than a sync:
an export that walks the atoms and writes a markdown file per atom into a
folder you choose, on demand. It is not a second copy that has to stay
consistent, because it is not read back.

Two rules follow, and they are worth stating because they are what keep the
mitigation honest.

- **A note body is never copied into the graph.** An atom carries a quote, a
  note id and the blob hash that note had when it was read. It does not carry
  the note. `learn.quiz_sources` already holds this line and says why: two
  copies of a note disagree the moment the vault syncs.
- **Prefer a row you can rebuild to a row you cannot.** Where a piece of state
  could be stored or derived, derive it. What cannot be derived is what you
  typed, which is precisely the set the export exists for.

### What Postgres holds

The mirror of the notes, the atoms, the edges, the overlays, the states, the
probe history and the spend ledger. All of it is either derived from the vault
or produced by using the app, and none of it is the vault's to hold.

---

## The layers

Four things, stacked, each addressing the one below it.

```
    overlays        interests, questions, goals, subjects, threads
        |           membership, with a reason per member
    relations       six typed edges; only `requires` is structural
        |
      atoms         one idea, one row, one verbatim quote back to a file
        |
    the record      1,244 notes, 4.48M characters, in git
```

Time runs through all four and is the reason to think of this as more than a
stack. A note has commits. An atom has a supersession chain and a date it was
last tested. An overlay has the period you cared about it. A state has a date
it was last actually true. Every layer can be asked what it looked like before,
and "you changed your mind about this in March" is a query rather than a
feature.

### 0. The record

Files. Verbatim, one-way from Obsidian, and written by nothing here.
`obsidian.notes` is a mirror of the record rather than the record itself, which
is why a rebuild of it is uninteresting and a loss of it is recoverable.

The record is never the unit of meaning. It cannot be: the vault holds a
147,133-character interview-prep file that yields two ideas and an
867-character book note that yields seven. Length predicts nothing about a
note and note type predicts almost everything, measured across a 290-fold
spread of density in the 30-note trial and confirmed on a random sample in
the [75-note trial](trials/2026-09-19-map-75-notes.md).

### 1. Atoms

The atomic layer you want, and the thing to be clear about is that an atom is
not a note. Your notes are not atomic and making them atomic would mean
rewriting five years of them. An atom is one idea, extracted or authored, with
a verbatim sentence pointing back at the file it came from.

Expected size after the full sweep is 1,500 to 2,500. Two differently drawn
samples agree: the stratified 30-note trial projected about 2,400 candidates,
and the random 75-note trial projected about 2,800 across the vault's 1,288
notes. Both land inside the bar once cross-note merging is applied.

### 2. Relations

Six typed edges between atoms. Only `requires` is acyclic and only `requires`
is read by anything structural. Detail below.

### 3. Overlays

A named set of atoms with a reason for each membership. This is the layer the
existing documents have no account of, and it is where interests live.

---

## The atom

### What qualifies

A position you could hold or not hold, and that could be argued with. Two
tests, both of which have to pass:

1. Could you write a question that somebody who holds this answers differently
   from somebody who does not?
2. Would being wrong about it cost you anything?

The second test was added after the trial. "NPV quantifies, IRR is comparable"
passes the first and nobody would argue it, and a bar that admits facts about
tools admits thousands of them.

This is the strictest rule here and it is what keeps the map small. Topic
labels are unlimited; positions in a field are not. `Behavioural economics` is
a shelf label, cannot be right or wrong, and does not go in this table.

### Four kinds

The kind decides how an atom is probed, which is the only reason it is a
column.

| kind | example | probed by |
|---|---|---|
| `claim` | Elasticity of supply decides who bears a tax | applying it to a case with the numbers changed |
| `position` | Single-stair buildings should be legal to six storeys | the strongest objection, and what would change your mind |
| `distinction` | Revealed versus stated preference | which side a given case falls on |
| `frame` | Base rates; five forces | applying it to a situation you have not seen |

The schema currently carries a different pair, `threshold` and `consequence`,
on a different axis entirely. That axis is worth keeping as a separate nullable
column: whether an idea is a door into a subject or a consequence of one is a
real property and the probe picker already reads it.

### What every atom carries

- `name`, short, for a list.
- `statement`, the position in one or two sentences. Generated first and
  overwritable; your version is what later probes are written against. The
  schema already has `claim` plus `claim_original` for exactly this.
- `basis`, how the map knows this, in a sentence. Same discipline as
  `locator_basis` on the reading side: "extracted from three notes you wrote"
  and "inferred from a clipping you saved" are different claims and the screen
  shows which one this is.
- `kind`, one of the four.
- `provenance`: `extracted`, `authored`, or `generated`.
- `stance`: `held`, `encountered`, or `generated`. A note in your own words is
  evidence you hold a position; a clipping is evidence you were interested,
  which is a different and still useful fact; a note a model wrote is neither.
  The 75-note trial found the third case is already in the vault and that the
  first two values cannot see it: one note carries an Obsidian callout saying
  Claude generated and expanded it from a seed idea, and it produced 9% of the
  sample's nodes, every one marked `held`. `generated` is read from that
  callout rather than inferred, and a generated node is not evidence of what
  you think until you say so.
- `centrality`, computed from edges, stored, recomputed when edges change.
- two to four **checks**: what having the idea looks like, what it rules out,
  what the standard objection is. Questions are written against a check rather
  than against the statement in general. Already built as `concepts.mastery`.

### Every atom traces to a quote, and the quote is verified

A provenance table, not a sentence: one row per atom per note it came from,
carrying the note id, the `blob_sha` that note had when it was read, and the
verbatim sentence that supports the atom.

**The sentence has to appear in the note body or the candidate is refused.**
This is the locate pass's rule moved one module over, and it is the same
argument: a model that returns a quote which is not in the text has invented
the quote, and a mechanical check catches it for free. The locate pass already
throws away an anchor phrase that is not found verbatim in the fetched page.

Keying on `blob_sha` is what makes the sweep re-runnable. A note that has not
changed is not re-read. A note that has changed is re-extracted and its old
rows are compared rather than duplicated. An atom whose every supporting quote
has disappeared from the record is not deleted; it is marked as no longer
grounded and stays, because you may well still hold it.

### Orphans

An extracted atom needs an edge. An authored one does not.

An atom with no connections that a model invented from a note is usually junk,
and refusing it removes most of the noise in one rule. An idea you typed on
purpose that connects to nothing is a frontier or a confusion, and both are
worth attention. Orphans get a holding area rather than a rejection, and the
connection check re-runs whenever the map grows.

The 2,833 wikilinks you drew by hand across 745 notes are ready-made edge
candidates, and the 417 that resolve to nothing are ready-made seeds: an
unresolved `[[link]]` is an idea you named and never wrote up.

---

## Edges

Six types for anything newly written, each with an optional one-line
description saying what the relation actually is. A seventh value exists to
carry the rows the old mentions table holds, and nothing new may use it.

| type | means | what reads it |
|---|---|---|
| `requires` | you cannot understand B at all without A | the frontier |
| `supports` | B is true partly because A is | the defend rung |
| `qualifies` | A bounds or conditions B | contradiction resolution |
| `contradicts` | these two cannot both stand | tension cards |
| `example-of` | a concrete case of something more abstract | the abstraction ladder, zoom |
| `same-as` | one idea under two names | reconciliation |

**The rule for a seventh: some feature has to read it.** An edge type with no
consumer is decoration, and a vocabulary built to capture every possible
relation becomes thirty types nobody maintains.

`requires` is the only one with structural consequences, is the only one that
must be acyclic, and is meant to be rare. The bar is "cannot understand at
all", which most relations do not clear. Parking minimums are not a
prerequisite for understanding incentive misalignment; they are an example of
it. Keeping this edge thin is what stops the frontier concluding that
everything depends on everything.

The type is closed and the description is not. A relation that does not fit is
degraded rather than lost, and after a few hundred edges the descriptions on
awkwardly typed edges are the evidence for whether a seventh type is needed.

**`concept_mentions` folds in as a seventh type, `mentions`, closed to new
writes.** That table exists only because the edge table is acyclic and two
claims that talk about each other are exactly the cycle the trigger refuses.
Once the acyclic constraint applies to `requires` alone, a mention is an
ordinary typed edge. Its consumer is named and already built: the "brings up"
list on the concept page. Existing rows migrate with their type set to
`mentions` rather than being guessed into one of the six, because a basis
invented later by matching names against claim text is the silent guess this
module is built against.

### The abstraction ladder is `example-of`

There is no separate structure for levels of detail. A more abstract atom is
an ordinary atom that others are examples of. More things point at it, so it
scores higher on centrality and survives a zoom-out.

The trial's best illustration: a note about a conversation with a friend
carries "cities should be built for people, not cars, even if that costs
efficiency, the same way runs are not the goal in sabermetrics." That is not a
duplicate of the position about surface parking in another note. It is the
principle the parking position is an instance of, and merging them would have
destroyed the ladder.

Two consequences answer how a pile of atoms becomes understanding. You can
walk up as well as down, so "what is this an example of?" is one hop from any
detail. And a neighbourhood can be given a written synthesis, constrained to
say only what its member atoms say, and editable.

### Zoom is centrality with a threshold

Every atom carries a score for how much depends on it, directly and
transitively, weighted so that `requires` counts most and `contradicts` not at
all. Zoom is how many atoms are shown, in that order.

The alternatives both fail. A stored hierarchy goes stale like any taxonomy.
Clustering at k levels reshuffles on every recompute, so the map looks
different each time you open it, which is disorienting enough to kill the
feature. A stored score is stable, needs no model call, and adding an atom
does not reshuffle the view.

The frontier query takes a centrality floor. That is the fix for the trial's
one real size worry: a large map does not hurt the view, because the view is
the top of it, but trivia crowding the frontier does hurt.

---

## Overlays

The layer above the atoms, and the part of this that no existing document
covers.

An overlay is a named set of atoms with a reason for each membership. Five
kinds, distinguished by what reads them rather than by what they contain.

| kind | what it is | example |
|---|---|---|
| `interest` | something you care about, whether or not you know anything about it | urbanism; how people learn |
| `question` | something you are carrying unanswered | does upzoning lower rents where it happens |
| `goal` | something you are trying to be able to do, with a target atom | understand the Phillips curve |
| `subject` | the academic container, demoted to a label | economics |
| `thread` | a line of thinking over a period | the twenty-hour work split argument |

### Rules

- **Membership is non-exclusive and cheap.** An atom is in as many overlays as
  apply. The concept that spans three fields is the one worth having, and a
  partition would force you to duplicate exactly those.
- **Every membership carries a basis.** Same discipline as an edge: a link
  nobody can argue with is a link nobody can correct.
- **Overlays do not nest.** A nested overlay is a taxonomy by another name and
  somebody has to maintain it. Narrower means another overlay, and an atom in
  both.
- **An empty overlay is legitimate and is often the interesting one.** An
  interest with no atoms is a subject you care about and have never written
  about. A question with no atoms is one you have been carrying without
  answering.
- **Nothing is auto-created.** Proposed and approved, like every other way into
  this store.
- **An overlay is a named set, not a saved query.** Derived membership is not
  in v1, because a saved query and a named set drift apart the moment you edit
  one and there is then no answer to which is the overlay.

### Shape

```
learn.overlays
  id, user_id
  kind            interest | question | goal | subject | thread
  name
  body            what you mean by it, in your words. Optional, and the useful field
  target_atom_id  goals only: the atom the chain leads to
  status          open | settled | dormant
  created_at, updated_at

learn.overlay_members
  overlay_id, atom_id
  basis           why this atom is in this overlay, in a sentence
  added_by        you | extraction | approval
  created_at
```

`learn.subjects` and `learn.goals` fold into this, which is the migration that
finally demotes subjects from containers to labels. The structural work
`concepts.subject_id` currently does, keeping both ends of an edge inside one
subject, goes away with it, because an edge between atoms in different subjects
is exactly the edge worth having once subjects are labels.

`concept_subjects`, added in migration `0020`, is superseded before it
acquired a single reader. Its own header says the full change is the right end
state and is a refactor rather than a migration. This is that refactor.

### Where interests without positions live

They are overlays, and this is the answer to the question the node test
otherwise leaves stranded. "I am interested in how cities finance themselves"
is not an atom, cannot be argued with, and would be correctly refused by
extraction. It is an interest, it can hold zero atoms, and it is one of the
most valuable rows in the graph: an interest with no atoms under it is the
clearest possible instruction to the reading queue.

Extraction proposes an overlay when a note is plainly about something without
taking a position on it, and proposes a `question` overlay when a note asks
something it never answers. Both go through the same approval as everything
else.

---

## Keeping the two levels apart

The rule is about writers, and it is one sentence: **the organising half only
ever proposes, and only an answer you gave writes a state.**

| | organising | knowing |
|---|---|---|
| written by | extraction, generation, your taps | an answer you typed or picked |
| lands at | `claimed` | `recognised`, `known`, `shaky`, `misconception` |
| cost of being wrong | one tap | the next question is wrong, and you notice |
| how it is corrected | reject, merge, retype, split | answer again |

Every state carries how it was established, and the schema already has the
three bases it needs: `tested`, `inferred`, `declared`. What is missing is the
state the vault pass lands at. `claimed`, established `inferred`, means your
notes say you have this. A hypothesis, not a finding.

This is also the answer to the worry about subjectivity. Judging what a note
means is unavoidable and will be wrong regularly, and it is safe here only
because it never touches the column that says what you know. The worst a bad
extraction can do is put a wrong row in a review queue.

### When things disagree

Most apparent contradictions are not contradictions, so the first job is
triage. Six kinds, of which two are real:

| what it is | what happens |
|---|---|
| scope mismatch, both true under different conditions | not a contradiction. Add the missing condition to each. This is what "it depends" means, spelled out |
| level mismatch, true at different levels | not a contradiction. Link `example-of` and name the level each speaks to |
| you changed your mind | a fact about you. Supersede, and keep the old one |
| a live dispute in the field | a property of the subject. Keep both, record the crux |
| you are inconsistent | the most valuable case. Pick, or find the distinction that saves both |
| one is simply wrong | retract it. It becomes a misconception record with the evidence |

The app does not resolve the disagreement. It shows both atoms, where each came
from, which kind it looks like, and a proposed crux, and you decide. The
resolution is a new atom holding the condition or distinction, joined to both
originals by `qualifies`, which is why that edge type exists.

An open contradiction drops both atoms out of `known`, because you do not know
something you contradict yourself about. A dismissal is permanent: a tension
you have already waved away reappearing is the fastest way to make the feature
look stupid.

The trial found one of these in a single 854-character note, which argues for
funding a basic income partly through a tax on exports and, two lines later,
says it is not in favour of tariffs. That is the same instrument pointed both
ways.

---

## Knowing how you think

The layers above are what make a recommendation specific to you rather than
specific to a topic you typed. Eight signals, all of them already implied by
the layers:

| signal | what it answers |
|---|---|
| interests, and their emptiness | what to look for, and where you have nothing |
| open questions | the single best prompt for sourcing |
| the `requires` frontier inside an interest | what you are ready for right now |
| centrality | what is load-bearing for you, as against what you merely filed |
| stance | your voice, and which positions are actually yours |
| open contradictions | the highest-value thing you could resolve |
| state and `tested_at` | what you think you know and have not checked in months |
| unresolved wikilinks | ideas you named and never wrote up |

**Ranking is a query, not a model call.** What matters to you is read off
stored rows. A model is used for phrasing and for finding sources, never for
deciding what is important. That keeps a page you open out of idleness free,
and it means every row can show the reason it is there, computed from rows you
can go and correct.

`/learn/next` already works this way and is the shape to extend rather than
replace.

### The loop this closes

An interest with an open question produces a reading. The reading produces a
note you were going to write anyway. The note produces atoms. The atoms attach
to the interest and to each other, raise or lower what the frontier offers,
and occasionally collide with something you already held. Probing settles which
of them you actually know. What you know changes what the queue offers next.

Every step already exists in some form. What is missing is that the first and
last steps do not currently read the same store.

---

## Where the schema disagrees with this

Eight items. Each is cheap at the size the graph is now and painful at 1,800
rows, which is the argument for doing all of them before the sweep.

| # | disagreement | where |
|---|---|---|
| 1 | subjects are structural containers, not labels | `concepts.subject_id`, `concept_edges.subject_id`, and the composite keys that depend on them |
| 2 | node kinds are `threshold`/`consequence`, not the four | `learn.concept_kind`, `0012` |
| 3 | edges are untyped, with mentions as a second table | `learn.concept_edges`, `learn.concept_mentions` |
| 4 | no `claimed` state, no `extracted`/`authored` origin, no stance | `learn.knowledge_state`, `learn.concept_origin`, `learn.concepts` |
| 5 | provenance is a prose sentence, with no note, blob or quote | `concepts.basis` |
| 6 | no disagreements, no `superseded_by`, no centrality | nothing exists |
| 7 | no overlays; interests have nowhere to live | `learn.subjects`, `learn.goals` |
| 8 | `concept_subjects` is superseded and has no readers | `0020` |

Two further items are not schema and block the same work:

- **The privacy policy describes mail ingestion only.** Two paths already send
  vault content to a model: quiz generation sends note bodies, and the
  classifier sends the first 1,500 characters of a note. The vault spec said
  the policy must change before the first vault-content model call, and that
  line has been crossed twice. It is first in the build order below.
- **The journal exclusion list does not exist.** The map spec relies on it as
  the one exclusion that stays, identified by a list you control rather than
  inferred.

### On names

The schema stays called `learn` and the notes stay in the one called
`obsidian`. Renaming either buys nothing and costs a sweep of every file that
references them, and this repo already has the precedent: the product is
called vault and the schema is not, for a reason written at the head of its
migration.

---

## Build order

Each step is useless without the one above it, which is the ordering rule the
rest of this repository already follows.

1. **The privacy page, and the journal list.** Before another note reaches a
   model. The page needs a section on vault content, what is sent, what is not,
   and that no vault content trains anything. The journal list is a setting,
   not an inference.
2. **The realignment migration series.** All eight items above, written and
   applied in one sitting, before any of it has 1,800 rows in it. The cycle
   trigger narrows to `requires`. `claimed` joins the state enum. The
   provenance table and the overlays pair are new. The subject demotion is the
   large one and touches roughly thirty files.
3. **One extraction seam.** Five prompts write chains today: a typed goal, a
   pasted briefing, declared prior learning, a reading's own note, and the
   floor under a missed question. A sixth caller, the vault path, reuses the
   briefing prompt. They already share `MASTERY_RULE` and `KIND_RULE` through
   two fragments. The node test, the four kinds, the six edge types and the
   verbatim quote rule belong in that shared fragment, written once, so a
   change to what an atom is does not have to be made five times.
4. **The sweep at scale.** 1,244 notes needs what the one-note slice
   deliberately has none of: a background job, a budget, and a resume point.
   `lib/core/inbox/pump-budget.ts` already answers "is there time for another
   batch", and the vault's own backfill is the pattern for storing a position
   rather than chaining invocations.
5. **The review queue.** Accept, merge or reject, one tap each, highest
   centrality first so the decisions that shape the map come before the ones
   that do not. The model proposes, the structure constrains, and you
   arbitrate. Letting the model decide produces a map you stop trusting, and
   maintaining a taxonomy by hand is work that stops after a fortnight.
6. **Centrality, and the frontier floor.** Graph arithmetic, no model call.
7. **Disagreements.** The sweep within neighbourhoods, the six kinds, the
   proposed crux, the resolution atom.
8. **Overlays in the interface.** Interests and questions, the emptiness that
   makes them useful, and the button that turns an open question into a track
   in the reading queue.
9. **The export.** One markdown file per atom, into a folder you pick, on
   demand. Independent of everything above and worth having once there is
   anything you typed to lose.

Steps 1 and 2 block everything else here. Steps 3 to 5 are the sweep itself,
6 to 8 are what makes its output usable, and 9 stands on its own.

### What "it worked" looks like

Agreed before it runs, so the result can be judged against something.

- 1,500 to 2,500 atoms. Under 800 means the bar is too high and only the
  obvious is being caught.
- Under 15% of extracted candidates rejected as orphans. More than that means
  edge extraction is the weaker half.
- Every atom traceable to at least one note and one verbatim sentence, with
  the sentence verified present.
- Nothing at `known`. The whole vault pass lands at `claimed`.
- Edge types spread rather than collapsed, with `requires` the rarest by a wide
  margin.
- The top twenty by centrality are recognisable as the things you actually
  think about. No metric catches this one and it decides whether the map is any
  good.

---

## What it costs

Modelled from the 75-note trial's measured classification split and current
Haiku 4.5 pricing, $1.00 and $5.00 per million tokens, at 3.6 characters per
token. The vault is 1,288 notes and 5,724,185 characters, of which 1,039 notes
clear the classify threshold.

| stage | cost |
|---|---|
| classify every note over the threshold | $0.78 |
| extract from the 48% that classify `knowledge` or `mixed` | $2.64 |
| reconcile, twenty pairs per call | $1.31 |
| cross-note edges and disagreements | $1.60 |
| centrality | free |
| **first full build** | **$6.34** |

At the roughly 60% extraction share the evidence-flag change below produces,
the total is $7.71.

Incremental syncs cost a fraction, because only changed notes are read and
`blob_sha` decides which those are.

The useful conclusion is that no design choice here should be made on cost.
The numbers are modelled rather than measured, and the spend ledger exists so
the first real run replaces this table with facts.

The one number that is a real risk is reconciliation. Trigram blocking plus
batched adjudication removes around 99% of the comparison space and needs no
new vendor. If the merge rate proves bad, the upgrade is pgvector, which
Supabase ships, with an embedding model from another vendor, since Anthropic
does not serve embeddings. Only that stage changes.

---

## What the sweep must not read

Two rules, both found by running the trial rather than by design.

**Journals are excluded by a list you control**, never inferred. Until the
list exists the sweep does not run, which is the one thing here a session
cannot settle.

**A note containing a credential-shaped string is skipped and reported,
never sent to a model.** Nine notes in the vault currently match
`sk-ant-`, `sk-proj-`, `ghp_` or `AKIA` patterns. The check is a regex over
the body before any call, the note is recorded as skipped on the sweep run
the way an oversized note already is, and the reason is shown rather than
swallowed. Extraction would otherwise post those keys to an API and store
them in the graph's evidence quotes.

---

## Privacy, and the one thing only you can do

Everything else here is settleable in a session. This is not.

**The journal exclusion list.** Which paths are journals is a judgement only
you can make, and the map spec excludes them on privacy rather than on yield.
Until the list exists the sweep should not run, because the one exclusion that
matters would not be in force.

No new credential is needed. The read-only PAT already stored is the access
this design wants, and it is why nothing here can damage the vault.

The policy page can be drafted in a session and needs your reading before it
ships, because it is a statement about your data made to you.

---

## Open questions

- **What counts as a journal.** Related to the list above, and worth deciding
  by looking at folders rather than in the abstract.
- **Whether a quiz should feed the map.** Quizzes deliberately touch no
  concepts today, on the grounds that a quiz over interview notes should not
  put one-off nodes into a subject that lives forever. Once subjects are labels
  that argument weakens, because there is no permanent container to pollute.
- **Whether the export should run on a schedule.** It is on demand above, on
  the grounds that a scheduled export is a second copy nobody reads until they
  need it and nobody notices has been failing. Against that, an atom you typed
  exists in one place. Decide it the first time the export is actually
  wanted.
- **Whether overlays should ever be derived.** Ruled out above for v1 with a
  reason. The case that would reopen it is an interest you maintain by hand
  that is plainly a query, and it should be reopened from a real one.
- **Whether probe history should export.** It is claimed above that nobody
  reads four hundred one-line answers. Worth checking against a real year of
  them rather than asserting.
- **The same atom in two fields, after the subject demotion.** Scoping dedup to
  a subject made the matching problem small. Without containers the blocking is
  over everything, which is more comparisons and more chances to merge two
  things that genuinely differ. Trigram blocking should still hold at this
  size, and it is the first thing to measure on the full sweep.

# Learn: the map

How the knowledge map is shaped, and how it is built from a vault of notes that
were never written to be mapped.

This sits underneath [LEARN-GRAPH-SPEC.md](LEARN-GRAPH-SPEC.md). That document
says what the graph is for: knowing what you know, finding the next thing worth
learning, probing the edge. This one defines a node, defines an edge, says what
happens when two of them disagree, and gives the procedure that turns 1,244
unstructured notes into a first map.

It revises four decisions in that document. Each revision is marked where it
appears, with its reason.

Written to [WRITING-GUIDE.md](WRITING-GUIDE.md).

---

**What moved.** [KNOWLEDGE-SPEC.md](KNOWLEDGE-SPEC.md) now owns the questions
this document raised and could not settle from inside extraction: where the
writing lives, what happens to an atom the app produces, and where an interest
that holds no position goes. It also turns provenance from a sentence into a
table keyed on the note's blob hash, with the supporting quote verified present
in the note. Node kinds, edge types, the disagreement lifecycle and the
procedure below are unchanged.

## Why the vault is the starting point

Most learning tools know nothing about the person using them, so they ask for a
topic and personalise from there. The original idea behind this module asked for
something else: *"a central base of everything you know, so you know what you
know and what is optimal to learn next."* The material for that already exists:

- 1,244 notes and 4.48 million characters in `obsidian.notes`.
- 2,791 wikilinks across 741 of those notes, drawn by hand over several years.

Reading all of it once with Haiku costs around a dollar in input tokens, so cost
is not the constraint. The constraint is that the notes were written as notes.
Some hold knowledge, some are travel plans, some are job applications, and some
are a single line that meant something at the time.

---

## The governing principle

The schema is strict and closed: four node kinds, six edge types, one lifecycle
for a disagreement. What fills the schema is discovered, and is expected to
churn.

Getting this backwards produces one of two failures:

- **A rigid taxonomy**, where categories are fixed and everything is assigned a
  slot, ends up describing the taxonomy instead of the person. Dewey Decimal was
  settled in 1876 and everything since has been fitted into it. A category tree
  maintained by hand goes stale within weeks.
- **A loose graph**, where every note links to every note through one
  undifferentiated edge type, is the Obsidian graph view. It looks good and it
  cannot answer what to read next.

---

## What a node is

A node is a position you could hold or not hold, and that could be argued with.
"Behavioural economics" is a shelf label. It cannot be right or wrong, it cannot
be probed, and nothing can meaningfully require it.

Every candidate has to pass two tests:

1. Could you write a question that someone who holds this answers differently
   from someone who does not?
2. Would being wrong about it cost you anything?

If either fails, it is not a node. The second test was added after the trial.
"NPV quantifies, IRR is comparable" passes the first test and nobody would argue
it, and a bar that admits facts about tools admits thousands of them.

This is the strictest rule in the design, for a practical reason: it is what
keeps the map small. Topic labels are unlimited; real positions in a field are
not. The strictness does deduplication that would otherwise be manual.

> **Revised.** LEARN-GRAPH-SPEC.md defined a node as "one claim you can be right
> or wrong about." That excluded most of what is worth mapping. An opinion about
> urban design is not a fact and is still worth holding well. Philosophy is
> organised as positions and objections, which makes it the easiest case rather
> than the hardest.

### Four kinds

The kind decides how a node is probed, which is the only reason it is a column.

| kind | example | how it is probed |
| --- | --- | --- |
| `claim` | Elasticity of supply decides who bears a tax | apply it to a case with the numbers changed |
| `position` | Single-stair buildings should be legal to six storeys | state the strongest objection; say what would change your mind |
| `distinction` | Revealed versus stated preference | given this case, which side is it |
| `frame` | Base rates; five forces | apply it to a situation you have not seen |

Every node also carries:

- `statement`: the position itself, in one or two sentences. Generated first,
  and overwritable. Your version is what later probes are written against.
- `basis`: how the map knows this. "Extracted from three notes you wrote" and
  "inferred from a clipping you saved" are different claims, and the difference
  stays visible. Same discipline as `locator_basis` on the reading side.
- `kind`, `centrality`, and `provenance`, described below.

---

## What an edge is

Six types, fixed, plus an optional free-text description on every edge.

### The rule for adding one

A vocabulary built to capture every possible relation becomes thirty types that
nobody maintains. The rule instead is that some feature has to read the type. An
edge type with no consumer is decoration.

| type | means | what reads it |
| --- | --- | --- |
| `requires` | you cannot understand B at all without A | the frontier computation |
| `supports` | B is true partly because A is true | the defend rung: *why do you hold this?* |
| `qualifies` | A bounds or conditions B | contradiction resolution; *under what conditions?* probes |
| `contradicts` | these two cannot both stand | tension cards |
| `example-of` | a concrete case of something more abstract | the abstraction ladder, and zoom |
| `same-as` | one idea under two names | reconciliation |

A seventh type has to name its consumer before it is added.

### The two that carry weight

`requires` is the only edge with structural consequences. It must be acyclic,
enforced by a database trigger rather than by convention, and it is the only edge
the frontier computation reads.

It is also meant to be rare. The bar is "cannot understand at all", which most
relations do not clear. Parking minimums are not a prerequisite for
understanding incentive misalignment; they are an example of it. Keeping this
edge thin stops the frontier concluding that everything depends on everything.

`supports` is easy to confuse with `requires`, and they answer different
questions:

- `requires` is about comprehension. Can you follow B without A?
- `supports` is about justification. Is B true partly because A is?

In `Bulk/Bulk - Ideas/On labor, jobs and working.md`, *"value created for
yourself still counts as value"* is a premise of the twenty-hour work-split
argument. You can follow the argument without the premise, so it is not
`requires`, but the argument depends on it. In a map made mostly of positions,
this is the structure that makes a position defensible, and the defend rung has
nothing to read without it.

> **Added after the 30-note trial.** `supports` and `qualifies` were not in the
> first draft. The trial found both by forcing relations into boxes they did not
> fit: premises went into `example-of` and `requires`, and boundary conditions
> had nowhere to go at all. One example of a boundary condition is *"regulate on
> principle, not prescription"*, bounded by *"except fire code, where the expert
> knows better than the user"*.
>
> `qualifies` also fixes an inconsistency the spec had with itself. The
> contradiction-resolution procedure below produces boundary nodes by design,
> and four edge types could not attach them.

### Every edge carries an optional description

One short line saying what the relation is, stored beside the type.

The type is closed and the description is not, which has two effects. A relation
that does not fit a type is degraded rather than lost. And after a few hundred
edges, the descriptions on awkwardly typed edges are the evidence for whether a
seventh type is needed, instead of the question being guessed at now.

Six types will probably not hold forever. The descriptions are how that gets
noticed.

### What was rejected, and why

- **`causes`.** A lot of this material is causal: AV fleets reduce parking
  demand, which makes redevelopment profitable. But a causal chain is usually
  better stored as one node describing the mechanism, and the type invites
  modelling the causal structure of the world, which has no floor.
- **`contrasts-with`.** Already handled by a node kind rather than an edge.
  "Adverse selection is hidden type, moral hazard is hidden action" is one
  `distinction` node, not two nodes and a relation.
- **`applies-to`**, for frames. Too thin. `example-of` covers it.

### Nodes deserve more suspicion than edges

A wrong node pollutes everything downstream of it. A wrong edge type is one bad
line in one view, fixed in a tap, and only `requires` has structural
consequences.

The open risk is cross-note edge extraction, which the trial did not test. Every
relation it found was stated inside a single note, as in *"Argument Against…
Counterpoint…"* and *"My example of this could be a Rubik's cube."* Most real
edges will be inferred between concepts that never appeared on the same page.
The wikilink prior in Stage 4 exists to reduce that difficulty.

Which nodes carry which edges is discovered. Only the six names and their
meanings are fixed.

### Highly connected nodes

A concept that appears across economics, urban design and organisational
behaviour is a general principle, and general principles are most of what
sharpness consists of. Those nodes are supposed to be highly connected.

The guard is the `requires` rule above. A hub accumulates `example-of` edges
rather than prerequisites, so the DAG stays thin even where the map is dense. The
map is also never drawn as one global force-directed graph. You look at a node
and its neighbours, grouped by edge type.

---

## Subjects are labels, not containers

A concept carries zero or more subjects. They are tags: cheap, non-exclusive,
and re-derivable from the graph at any time. The edges hold the structure and
subjects index it.

There is no `category` column and no stored hierarchy anywhere in this design,
because a stored category has to be maintained by somebody.

> **Revised.** LEARN-GRAPH-SPEC.md said one graph per subject, with subjects as
> containers. The concepts that make somebody sharp are the ones that span
> subjects: compounding, base rates, incentives, selection effects, marginal
> thinking. A hard partition forces duplication of exactly those nodes and hides
> the connections between them. One graph, with subjects as tags.
>
> Everything else in that document stands: claims, states, probes,
> misconceptions, portals, the probe ladder.

---

## Zoom, and getting from detail to understanding

The original idea asked for Google-Maps-style levels. There are three ways to do
it and two of them fail:

- **Store a hierarchy.** Rigid, and it goes stale like any taxonomy.
- **Cluster at *k* levels.** Adaptive, but unstable. The clusters reshuffle on
  every recompute, so the map looks different each time it is opened, which is
  disorienting enough to kill the feature.
- **Rank by structural importance and zoom by threshold.** This is the one to
  build.

Every node carries a centrality score computed from its edges: roughly, how much
depends on it, directly and transitively. Zoom level is then how many nodes are
shown, in that order. Fully zoomed out shows the twelve most-depended-on ideas
in the map. Fully zoomed in shows everything.

It is stable, since adding a node does not reshuffle the view. It stores one
number per node and needs no model call. It is also the mechanical version of the
*legendary / rare / common* idea from the original document: legendary means high
centrality, computed rather than asserted.

### The abstraction ladder is `example-of`

There is no separate structure for levels of detail. A more abstract node is an
ordinary node that other nodes are examples of:

```
"A cost should fall on whoever decides to incur it"
        ^ example-of
"Parking minimums push the cost of car storage onto renters who do not drive"
```

Both are nodes. The upper one has more things pointing at it, so it scores higher
on centrality and survives the zoom-out. The ladder comes out of edges that are
already there.

Two consequences answer the question of how a pile of atoms becomes
understanding:

- **You can walk up as well as down.** From any detail, "what is this an example
  of?" is one hop. This is the defence against the Anki failure of being sharp
  about particulars and blank about principles.
- **A neighbourhood gets a written synthesis.** A paragraph saying what the
  cluster is about, generated but constrained to say only what its member nodes
  say, and editable.

---

## Orphans

Extracted nodes need an edge. Authored nodes do not.

A node with no connections that a model invented from a note is usually junk, and
refusing it removes most of the noise in one rule. A node you typed on purpose
that connects to nothing is different: an idea you hold that attaches to nothing
you know is either a frontier or a confusion, and both are worth attention.

Orphans therefore get a holding area rather than a rejection, and the connection
check re-runs over them whenever the map grows. The unresolved `[[wikilinks]]` in
the vault are ready-made seed nodes: an idea named and never written up.

> **Revised.** LEARN-GRAPH-SPEC.md said "nothing is added without an edge", with
> no exception. The exception is authorship.

---

## When things disagree

Most apparent contradictions are not contradictions. A system that flags a
conflict at every pair of nuanced statements gets ignored within a week, so the
first job is triage rather than resolution.

### Six kinds

| what it actually is | example | what happens |
| --- | --- | --- |
| **Scope mismatch**, both true under different conditions | "Minimum wages cut employment" / "Card–Krueger found no effect" | Not a contradiction. Add the missing condition to each. This is what "it depends" means, spelled out. |
| **Level mismatch**, true at different levels | Individually rational, collectively ruinous | Not a contradiction. Link `example-of` and name the level each speaks to. |
| **You changed your mind** | A 2023 note says X, a 2026 note says not-X | A fact about you rather than about the world. Supersede, and keep the old one. |
| **A live dispute in the field** | Two credible economists disagree | A property of the subject rather than an error. Keep both, record who is on each side and what the crux is. Knowing a field's open disputes is part of being sharp about it. |
| **You are inconsistent** | You hold two things that cannot both stand | The most valuable case. Pick, or find the distinction that saves both. |
| **One is simply wrong** | Bad source, misremembered | Retract it. It becomes a misconception record with the evidence attached. |

Only two of the six are real contradictions. The other four are clarifications,
and surfacing them is worth as much: scope and level are where an amateur take
usually falls apart.

### How one is found

Three points, all cheap:

- **At extraction.** The reconcile pass already compares each candidate against
  what exists. Pairs that are highly similar but opposed fall out of the same
  comparison at no extra cost.
- **At probe time.** You answer in a way that cuts against a stored position.
  This is the strongest signal available, because it is you contradicting
  yourself in the moment.
- **On a sweep, within neighbourhoods only.** All-pairs does not scale, since 500
  nodes is 125,000 comparisons, and it is unnecessary: contradictions sit close
  together in the graph.

### What the app does about it

It does not resolve the disagreement. The model is not the arbiter of what you
believe, and a system that quietly decides which of your two beliefs wins is
worse than no system.

It shows both nodes, where each came from, which of the six kinds it looks like,
and a proposed crux: one sentence naming what the disagreement turns on. You
decide.

The resolution is not a deletion. It is a new node holding the condition or
distinction that separates the two.

> **A** (a 2024 note): *Upzoning lowers rents.*
>
> **B** (a later clipping): *New luxury buildings are associated with rising
> neighbourhood rents.*
>
> This is scope plus level: metro-wide supply effects over years, against local
> selection effects, since new buildings go up where demand is already climbing.
>
> **Resolution:** *Upzoning lowers rents metro-wide over years; new construction
> correlates with local rent rises because it is built where demand is rising.*
>
> The resolution is a new node, joined to both originals by `qualifies`. That
> edge type exists because of this procedure: a scope or level mismatch resolves
> into a boundary, and a boundary needs somewhere to attach.

The resolution node is more useful than either of the originals, and producing
one is the difference between having read about housing and being able to argue
about it.

### Consequences in the data

- An open contradiction drops both nodes from `known` to `shaky`. You do not know
  something you contradict yourself about.
- Superseded nodes are never deleted. They carry `superseded_by`, which is what
  lets the app say "you changed your mind about this in March, and here is what
  moved you."
- A disagreement is its own row rather than a flag on an edge, because it has a
  lifecycle: `open`, `resolved`, `live_dispute`, `superseded`, plus the crux, the
  resolution, and a date.
- A dismissal is permanent. Once a pair is marked "not a contradiction" it never
  surfaces again. A dismissed tension reappearing is the fastest way to make the
  feature look stupid.

---

## Provenance and state

Two things that are easy to conflate.

**Provenance** is where a node came from: `extracted` if a model read it in a
note, `authored` if you typed it, `generated` if it was produced when a goal was
expanded. It decides the orphan rule, and it is shown on the node.

**State** is how well you hold the node. Vault-derived state is never `known`:

| state | means |
| --- | --- |
| `claimed` | your notes say you have this. A hypothesis, not a finding. |
| `shaky` | tested and wobbly, or inside an open contradiction |
| `known` | tested and held |
| `misconception` | tested, and wrong in a specific, named way |

Everything the vault pass produces lands at `claimed`, and probing is the only
thing that promotes it. A map that credits you with knowing 400 things because
you once saved an article is useless for deciding what to learn next.

---

## The procedure

What runs, in order. Stages 0 to 3 are the first build. Stages 4 to 7 follow
immediately, but are separable.

### Stage 0 — Classify

Every note is classified and almost every note is read. One cheap call each, over
the first 1,500 characters, returning one of four classes:

| class | what happens |
| --- | --- |
| `knowledge` | goes to extraction |
| `mixed` | goes to extraction |
| `evidence` | produces no concepts, but raises confidence in concepts found elsewhere: coursework, transcripts, a CV, an application describing what you can do |
| `operational` | skipped: logistics, meeting arrangements, task lists, contact details |

> **Revised by the [75-note trial](trials/2026-09-19-map-75-notes.md), in two
> places, and both for the same reason the folder rules were revised: a
> routing rule was discarding material the node test would have handled.**
>
> **`evidence` becomes a flag, not a fourth class.** Eleven of 75 notes
> classified `evidence` and produced nothing, and three readers independently
> reported that it cost real positions: a case write-up judging Hamilton a
> great applied economist, a course summary carrying the
> social-licence-to-operate idea, an application arguing that leaning on a
> model to write code is now the right way to work. All three are the author's
> own positions inside a note whose *purpose* is to evidence what they were
> taught. Purpose and content are independent, and the class was reading only
> purpose. The classes become `knowledge`, `mixed` and `operational`, with an
> `is_evidence` boolean alongside, so a note can be evidence and still be read
> for claims.
>
> **The free-skip threshold drops from 200 characters to 80.** The rule exists
> so 249 stubs cost nothing, and most of them are stubs. But four readers
> reported it destroying the densest notes in the vault: a 128-character note
> stating that striving is itself a moral act, a 149-character pair of Blake
> aphorisms, a 146-character position on what city technology owes people who
> want a simpler life. A short note that states one thing plainly is the best
> shape a node can come from, and the rule was biased against exactly that. Of
> the 228 notes under 200 characters, 61 contain an argumentative verb; 130 sit
> between 80 and 199 and become classify calls, which at the measured cost is a
> rounding error.

**There is no folder routing.** The original design excluded whole paths such as
`Me/` and application files, on the reasoning that a folder is a free and
predictable filter. Two findings from the trial changed that:

- `Me/People/Chewy.md` is a note about a conversation with a friend, mostly
  wedding logistics and a phone call. It also contains *"cities should be built
  for people, not cars — even if that costs efficiency, efficiency is not the
  goal, the same way runs are not the goal in sabermetrics"*, which was among the
  three best nodes in the sample. A folder rule would have discarded it.
- A dated Armodafinil dosage log sat in an included folder and produced nothing,
  because the node test rejected all of it.

The node test filters personal content better than a folder does, in both
directions: it keeps the good line in the personal note and drops the log in the
knowledge folder. The folders in this vault were never maintained as a taxonomy,
which is why the folder rule looked cheap and was not.

The one exclusion that stays is the journal, excluded on privacy rather than
yield. It is identified by an explicit list you control, not inferred.

### Stage 1 — Chunk

Split each note on its headings. Sections under about 200 characters merge into
their neighbour, and sections over about 4,000 split on paragraph boundaries.
Extraction runs per chunk, so a 20,000-character essay is not processed in one
pass.

**Chunk the whole note; never truncate it — and raise the section cap, which
is the real limit.** The 75-note trial truncated at 6,000 characters for its
own convenience and paid for it: its richest note yielded 17 candidates from
the first 6,000 of 54,070 characters, with a class-logistics wrapper hiding a
sustained argument about car-dependent development.

Reading `splitBriefing` afterwards showed the trial's truncation was the
smaller problem. The chunker cuts on headings when a note has more than one,
and otherwise groups blank-line blocks up to 6,000 characters. Then
`MAX_BRIEF_SECTIONS` stops the import after **ten** sections. The effect is
the opposite of what anybody would guess:

| note | chars | sections | read |
|---|---|---|---|
| `Pending/Property and Regulation Study Guide.md` | 302,851 | 219 | 3.6% |
| `Bulk/Strong Towns Housing Course.md` | 40,683 | 78 | 6% |
| `Bulk/.../World building simulator.md` | 50,842 | 43 | 8% |
| `Pending/Casanova … Lottery Passage.md` | 37,480 | 7 | **100%** |

**A well-structured note is punished hardest.** More headings means smaller
sections, so ten of them is a smaller share of the note. The copied book
passage, which has no headings at all and falls to the 6,000-character
grouping, is read in full in seven sections. The study guide, which is
carefully organised, is read at 3.6%.

Across the vault this is not an edge case. 365 notes carry more than one
heading; 63 of them exceed ten sections, and **1,927,088 characters, 40.7% of
the text in those notes, would never be read.**

Three smaller faults in the same function:

- **A single oversized block is never split.** The grouping loop only flushes
  when adding the *next* block would exceed the limit, so a block larger than
  the limit goes into a section alone.
  `Pending/New Orleans Data Center Full Transcript.md` is 54,709 characters
  with one blank line in it, which becomes one section of 54,658 characters in
  a single call.
- **Anything before the first heading is discarded.** The loop only collects
  lines once it has seen a heading, so a note that opens with two paragraphs
  and then starts its headings loses those paragraphs silently.
- **The vault path has no length check at all.** `proposeBrief` validates the
  paste box against `MAX_BRIEFING_CHARS` and says so; `proposeFromNote` passes
  `note.body` straight through at any size.

What the sweep needs: cap on **characters read**, not sections; split a block
that exceeds the section size rather than passing it whole; keep the preamble;
and report what was skipped per note on the sweep run, the way an oversized
note already is. The ten-section cap was written for a pasted briefing, where
somebody chose what to paste. It is the wrong shape for a vault.

> **Revised.** LEARN-GRAPH-SPEC.md implied a budget of about three concepts per
> note, which is wrong for a dense note. The thing to guard against is
> restatement, where the same idea is pulled out five times in slightly
> different words, and reconciliation in Stage 3 catches that better than a cap.
> If a long essay contains fifteen distinct positions, take fifteen.
>
> There is no characters-per-concept guideline either. An earlier draft offered
> one concept per 800 to 1,200 characters as a sanity check. The trial found
> density spanning 290x, from 181 characters per node in a distilled economics
> course note to 52,937 in a case-prep research dump. Length predicts nothing.
> Note type predicts almost everything, which is what Stage 0 classifies.

### Stage 2 — Extract

One call per chunk. Haiku, tool-shaped output, returning candidates with:

- `name`, `kind`, `statement`
- `evidence`: the sentence in the note that supports it, verbatim
- `stance`: whether the writer appears to **hold** this or to have **encountered**
  it. A note written in your own words is evidence you hold a position. A
  clipping is evidence you were interested, which is a different and still useful
  fact.
- `confidence`
- candidate edges within this chunk: a type from the six, and a one-line
  description of the relation

Every candidate has to pass the node test. The prompt states it as a refusal: if
you cannot write a question that separates somebody who holds this from somebody
who does not, do not return it.

### Stage 3 — Reconcile

This stage decides whether the map is 400 nodes or 3,000.

1. **Block on lexical similarity.** Postgres trigram matching over names and
   statements, producing a small set of candidate matches per new node. This is
   SQL rather than a model call, and it removes around 99% of the comparison
   space.
2. **Adjudicate in batches.** One call per twenty candidate pairs, returning
   `same`, `different` or `opposed` for each. Batching keeps the stage cheap; one
   call per pair would cost more than everything else combined.
3. **Act.** `same` merges and keeps both sources on the surviving node.
   `different` creates. `opposed` creates the node and opens a disagreement row,
   which is where most contradictions are found at no extra cost.

Embeddings are not used in the first build. Trigram blocking plus model
adjudication needs no new vendor, since Anthropic does not serve embeddings, and
it is likely good enough at this size. If the merge rate proves bad, the upgrade
is `pgvector`, which Supabase already ships, with Voyage for the embeddings. Only
this stage changes.

### Stage 4 — Edges across notes

Three sources, in order of how much they are trusted:

1. **Your wikilinks.** If node A came from note N, node B came from note M, and N
   links to M, that pair is a strong edge candidate. 2,791 of these already
   exist, drawn by you. The model only has to name which of the six types it is
   and describe it in a line, which is much easier than inventing the relation.
2. **Co-occurrence** within a chunk, already captured in Stage 2.
3. **Inference** within a neighbourhood, for the rest.

Then the DAG check: any `requires` edge that would close a cycle is refused by
the database.

### Stage 5 — Disagreements

Sweep within neighbourhoods for the cases Stage 3 could not see, where the
statements are not lexically similar but the positions still collide. Each one is
classified into the six kinds and given a proposed crux.

### Stage 6 — Centrality

Compute the score for every node, store it, and recompute when edges change.
Graph arithmetic, no model call.

### Stage 7 — Review

What survives goes to a queue. Accept, merge or reject, one tap each, highest
centrality first so the decisions that shape the map come before the ones that do
not.

This stage answers the question of how rigid the system should be. The model
proposes, the structure constrains, and you arbitrate. Letting the model decide
produces drift and a map you do not trust; making you maintain a taxonomy is work
that stops after a fortnight. Ten seconds a day keeps the map yours.

The same rule applies afterwards: the map never silently reorganises itself.
Restructuring is always a proposal you accept.

---

## What a new idea does to an existing map

Three cases, handled differently:

- **It fits and the map did not know.** Attach it, silently.
- **It collides with something already there.** Do not overwrite. Open a
  disagreement and surface it as a card in the daily loop.
- **It is new territory.** It becomes a seed node. When three or four seeds start
  clustering, the system says a new area may be emerging rather than declaring
  one.

---

## Cost

Estimates, to be checked against the spend ledger rather than trusted. Haiku
throughout; using Sonnet for extraction roughly triples that line.

| stage | rough cost |
| --- | --- |
| Classify 1,244 notes (first 1,500 chars each) | ~$0.60 |
| Extract from what classifies as knowledge or mixed | ~$2.00 |
| Reconcile, batched twenty pairs per call | ~$0.30 |
| Edges and disagreements | ~$0.50 |
| Centrality | free |
| **First full build** | **under $6** |

None of this is verified. The 30-note trial was run by hand rather than through
Haiku, because the sandbox it ran in had no API key, so nothing here has been
measured against a bill. The spend ledger exists so the first real run replaces
this table with facts.

Incremental syncs cost a fraction of the above, since only changed notes are
read.

---

## What "it worked" looks like

Agreed before anything runs, so the result can be judged.

- **1,500 to 2,500 concepts** from 1,244 notes. Under 800 means the bar is too
  high and only the obvious is being caught.

  > **Revised after the trial.** This said 300 to 600, and called anything over
  > 2,000 a hairball. The sample projects to 1,600 to 1,800 after reconciliation,
  > so the trial failed against the old number. The old number was wrong: it
  > conflated the map with the view, and centrality already separates them. A
  > 2,000-node map whose top 150 you look at is workable. Size only hurts in one
  > place, which is the frontier computation getting crowded by trivia, and the
  > fix for that is a centrality floor on the frontier query.
- **Under 15% of extracted candidates rejected as orphans.** More than that means
  edge extraction is the weaker half, not node extraction.
- **Every node traceable** to at least one note and one verbatim sentence.
- **Nothing at `known`.** The whole vault pass should land at `claimed`.
- **At least a handful of disagreements**, most of which should turn out on
  inspection to be scope or level mismatches. If they are all flagged as genuine
  conflicts, the classifier is too eager.
- **Edge types spread rather than collapsed.** If nearly everything is
  `example-of`, typing is not happening, and the descriptions are where to look
  for the reason. `requires` should be the rarest of the six by a wide margin.
- **The top twenty by centrality should be recognisable** as the things you
  actually think about. No metric catches this one, and it decides whether the
  map is any good.

---

## The 30-note trial

Before the full pass, run Stages 1 to 3 over a stratified sample: ten from
`Bulk`, ten from `Pending`, five from `Me` or `Yale`, and five at random from the
rest. Cost is a few cents.

What to look at, in order:

1. **Are the nodes positions, or are they topics?** This decides whether any of
   the rest works. A list that reads like a table of contents has failed, however
   tidy it looks.
2. **Is `stance` right?** Does it tell a note you wrote from a page you clipped?
3. **How many duplicates survive reconciliation** across the thirty.
4. **Do the edge types mean anything**, or is everything `example-of`?
5. **Does classification behave?** Did anything personal come through that should
   not have?

Any of these failing changes the design before $5 is spent on the wrong shape.

The run against the live vault is written up in
[trials/2026-09-16-map-30-notes.md](trials/2026-09-16-map-30-notes.md).

A second, larger run followed on 2026-09-19: 75 notes drawn at random rather
than stratified, through Stages 0 to 2, written up in
[trials/2026-09-19-map-75-notes.md](trials/2026-09-19-map-75-notes.md). It
confirmed the node definition and the verbatim-quote rule, put `requires` at
6% of edges where the design wants it rarest, and produced the two routing
revisions above. Neither trial has been run through Haiku, so the model tier
remains unverified.

# Learn: the map

How the knowledge map is shaped, and how it gets built from a vault of notes
that were never written to be mapped.

This is the layer underneath [LEARN-GRAPH-SPEC.md](LEARN-GRAPH-SPEC.md). That
document says what the graph is *for* — knowing what you know, finding the next
thing worth learning, probing the edge. This one says what a node is, what an
edge is, what happens when two of them disagree, and the exact procedure that
turns 1,244 unstructured notes into the first version of the map.

It revises four decisions in that document. They are marked **Revised** where
they appear, with the reason.

---

## Why the vault is the starting point

Every learning tool starts knowing nothing about you, asks you to pick a topic,
and calls that personalisation. The original idea behind this module asked for
the opposite — *"a central base of everything you know, so you know what you
know and what is optimal to learn next"* — and the thing that makes it possible
is already here:

- **1,244 notes, 4.48 million characters** in `obsidian.notes`.
- **2,791 wikilinks across 741 of those notes** — connections drawn by hand,
  over years, before any of this existed.

Reading all of it once, with Haiku, costs on the order of a dollar in input
tokens. The expensive-sounding option is the cheap one. What stops this being
easy is not cost, it is that the notes were written as notes: some are
knowledge, some are travel plans, some are job applications, some are a single
line that meant something at the time.

---

## The governing principle

**Be rigid about the shape of a fact. Be loose about which facts exist.**

Every design question below resolves with that sentence. The schema is strict
and closed: four node kinds, six edge types, one lifecycle for a
disagreement. What populates the schema is entirely discovered and expected to
churn.

Both failure modes come from getting this backwards:

- **A rigid taxonomy** — fixed categories, everything assigned a slot — starts
  describing the taxonomy rather than the person. Dewey Decimal was settled in
  1876 and everything since has been crammed into it. A category tree you
  maintain by hand rots in about six weeks.
- **A loose graph** — every note linked to every note, one undifferentiated
  edge type — is the Obsidian graph view: beautiful, and it has never once told
  anybody what to read next.

---

## What a node is

**A position you could hold or not hold, and that could be argued with.**

Not a topic. Not a tag. Not a note. "Behavioural economics" is a shelf label:
it cannot be right or wrong, it cannot be probed, and nothing can meaningfully
require it.

The test, applied to every candidate, has two halves:

1. *Could you write a question that someone who holds this answers differently
   from someone who does not?*
2. *Would being wrong about it cost you anything?*

If either fails, it is not a node. The second half was added after the trial:
"NPV quantifies, IRR is comparable" passes the first test and nobody would ever
argue it, and a bar that admits facts about tools admits thousands of them.

This is the one place to be uncompromising, and the reason is practical rather
than aesthetic: strictness here is what keeps the map small. There are
infinitely many topic labels and a bounded number of real positions in a field.
The rigidity does the deduplication that would otherwise have to be done by
hand.

> **Revised.** LEARN-GRAPH-SPEC.md defined a node as "one claim you can be right
> or wrong about." That was too narrow and it excluded most of what is worth
> mapping. An opinion about urban design is not a fact and is absolutely worth
> holding well; philosophy is *organised* as positions and objections and is the
> easiest case of all, not the hardest. Sharp people are not the ones who know
> more facts — they are the ones who hold positions well and know the objections
> to them.

### Four kinds

The kind decides how the node is probed, which is the only reason it exists as a
column.

| kind | example | how it is probed |
| --- | --- | --- |
| `claim` | Elasticity of supply decides who bears a tax | apply it to a case with the numbers changed |
| `position` | Single-stair buildings should be legal to six storeys | state the strongest objection; say what would change your mind |
| `distinction` | Revealed versus stated preference | given this case, which side is it |
| `frame` | Base rates; five forces | apply it to a situation you have not seen |

Every node also carries:

- **`statement`** — the position itself, one or two sentences. Generated at
  first, and overwritable by you. If you cannot write it in your own words you
  do not have it, and your version is what later probes are written against.
- **`basis`** — how the map knows this. "Extracted from three notes you wrote"
  and "inferred from a clipping you saved" are different claims and the
  difference stays visible. Same discipline as `locator_basis` on the reading
  side.
- **`kind`**, **`centrality`**, **`provenance`** (below).

---

## What an edge is

A closed set of six types, plus a free-text description on every edge.

### The rule for adding one

Not *does the vocabulary capture reality* — it never will, and a vocabulary
built to try becomes thirty types nobody maintains. The rule is: **some feature
has to read it.** An edge type with no consumer is decoration.

| type | means | what reads it |
| --- | --- | --- |
| `requires` | you cannot understand B at all without A | the frontier computation |
| `supports` | B is true partly because A is true | the defend rung — *why do you hold this?* |
| `qualifies` | A bounds or conditions B | contradiction resolution; *under what conditions?* probes |
| `contradicts` | these two cannot both stand | tension cards |
| `example-of` | a concrete case of something more abstract | the abstraction ladder, and zoom |
| `same-as` | one idea wearing two names | reconciliation |

A seventh would have to name its consumer before it gets added.

### The two with teeth

**`requires`** is the only edge with structural consequences: it must be
acyclic, enforced by a database trigger rather than by convention, and it is
the only edge the frontier computation reads.

It is deliberately **rare**. The bar is *cannot understand at all*, which most
relationships do not clear. Parking minimums are not a prerequisite for
understanding incentive misalignment; they are an example of it. Keeping this
edge thin is what stops the frontier deciding that everything depends on
everything.

**`supports`** is the backbone of everything the module is for, and it is easy
to confuse with `requires`. They are different questions:

- `requires` is about **comprehension**. Can you follow B without A?
- `supports` is about **justification**. Is B true partly because A is?

In `Bulk/Bulk - Ideas/On labor, jobs and working.md`, *"value created for
yourself still counts as value"* is a premise of the twenty-hour work-split
argument. You can follow the argument perfectly well without the premise, so it
is not `requires` — but the argument stands or falls on it. In a map made mostly
of positions, this is the structure that makes a position defensible rather than
merely held, and the defend rung has nothing to read without it.

> **Added after the 30-note trial.** `supports` and `qualifies` were not in the
> first draft, and the trial found both by forcing relations into boxes they did
> not fit. Premises went into `example-of` and `requires`; boundary conditions —
> *"regulate on principle, not prescription"* qualified by *"except fire code,
> where the expert knows better than the user"* — had nowhere to go at all.
>
> `qualifies` also fixes an inconsistency the spec had with itself. The
> contradiction-resolution procedure below **produces** boundary nodes by
> design: *"upzoning lowers rents metro-wide over years; new construction
> correlates with local rent rises because it is built where demand is
> climbing"* is a scope qualifier over two existing nodes, and four edge types
> could not attach it.

### Every edge carries an optional description

One short free-text line saying what the relation actually is, beside the type.

The type is closed; the description is not. When the extractor cannot type a
relation cleanly it still records what the relation *was*, which means two
things. A relation that does not fit is degraded rather than lost. And after a
few hundred of them, reading the descriptions on edges whose type sat awkwardly
is how a seventh type gets discovered — from evidence, rather than from
somebody in a document guessing today.

That is the honest answer to *will six hold forever*. Probably not, and the
point is being able to tell.

### What was rejected, and why

- **`causes`.** Tempting, because a lot of this material is causal — AV fleets
  reduce parking demand, which makes redevelopment profitable. But a causal
  chain is usually better as one node stating the mechanism, and the type
  invites modelling the causal structure of the world, which has no floor.
- **`contrasts-with`.** Already handled, by a node *kind* rather than an edge.
  "Adverse selection is hidden type, moral hazard is hidden action" is one
  `distinction` node, not two nodes and a relation between them.
- **`applies-to`**, for frames. Too thin. `example-of` covers it.

### Be paranoid about nodes, relaxed about edges

Worth stating because the instinct runs the other way. A wrong node pollutes
everything downstream of it. A wrong edge type is one bad line in one view,
fixed in a tap — and only `requires` has structural consequences, so only
`requires` deserves real suspicion.

The genuine unknown is not the vocabulary but **cross-note edge extraction**,
which the trial did not test. Every relation it found was stated inside a single
note — *"Argument Against… Counterpoint…"*, *"My example of this could be a
Rubik's cube"* — which is the easy case. Most real edges will be inferred
between concepts that never appeared on the same page, and that is what the
wikilink prior in Stage 4 exists to make easier.

Which nodes carry which edges is entirely discovered. Only the six names and
their meanings are fixed.

### Hubs are a feature, with one guard

A concept that appears across economics, urban design and organisational
behaviour is a *general principle*, and general principles are most of what
sharpness is made of. Those nodes are supposed to be highly connected.

The guard is the `requires` rule above. A hub accumulates `example-of` edges,
not prerequisites, so the DAG stays thin even where the map is dense. And the
map is never drawn as one global force-directed ball — you look at a node and
its neighbours, grouped by edge type. Google Maps does not render every street
on Earth at once either.

---

## Subjects are labels, not containers

A concept carries zero or more subjects. They are tags: cheap, non-exclusive,
and re-derivable from the graph at any time. The edges are the truth; subjects
are an index over the truth.

There is no `category` column and no stored hierarchy anywhere in this design.
The moment a category is stored, somebody owns maintaining it.

> **Revised.** LEARN-GRAPH-SPEC.md said one graph per subject, with subjects as
> containers. That is wrong for a specific reason: the concepts that make you
> sharp are exactly the ones that span subjects — compounding, base rates,
> incentives, selection effects, marginal thinking. A hard partition forces
> duplication of precisely the highest-value nodes and hides the connections
> that are the point. One graph. Subjects as tags.
>
> Everything else in that document stands: claims, states, probes,
> misconceptions, portals, the probe ladder.

---

## Zoom, and getting from detail to understanding

The original idea asked for Google-Maps-style levels. Three ways to do it, and
two of them are traps.

- **Store a hierarchy.** Rigid, and it rots like any taxonomy.
- **Cluster at *k* levels.** Adaptive, but *unstable*: the clusters reshuffle on
  every recompute, so the map looks different each time it is opened. That is
  disorienting enough on its own to kill the feature.
- **Rank by structural importance and zoom by threshold.** ← this one.

Every node carries a **centrality** score computed from the edges: roughly, how
much depends on it, directly and transitively. Zoom level is then just *how many
nodes are shown*, in that order. All the way out: the twelve most-depended-on
ideas in the map. All the way in: everything.

It is stable — adding a node does not reshuffle the view — it stores nothing but
one number per node, and it needs no model call. It is also the mechanical
version of the *legendary / rare / common* instinct from the original document:
legendary **is** high centrality, computed rather than asserted, so it cannot
flatter.

### The abstraction ladder is just `example-of`

There is no separate structure for levels of detail. A more abstract node is an
ordinary node that other nodes are examples of:

```
"A cost should fall on whoever decides to incur it"
        ^ example-of
"Parking minimums push the cost of car storage onto renters who do not drive"
```

Both are nodes. The upper one has more things pointing at it, therefore scores
higher on centrality, therefore survives the zoom-out automatically. The ladder
falls out of edges that are already there.

Two consequences worth stating, because they are the answer to *how does a pile
of atoms become understanding*:

- **You can walk up as well as down.** From any detail, "what is this an example
  of?" is one hop. That move is what turns trivia into understanding, and it is
  the defence against the Anki failure — sharp about particulars, blank about
  principles.
- **A neighbourhood gets a written synthesis.** A paragraph saying what this
  cluster is actually *about*, generated but constrained to say only what its
  member nodes say, and editable. Understanding you can read rather than infer
  from a picture.

---

## Orphans

The rule is **extracted nodes need an edge; authored nodes do not.**

A node with no connections that a model invented from a note is almost always
junk, and refusing it removes most of the noise in one line. A node *you typed
on purpose* that connects to nothing is the opposite: it is a declaration, and
it is one of the most interesting rows in the database. An idea you hold that
attaches to nothing you know is either a frontier or a confusion, and both
deserve attention.

So orphans get a holding area rather than a rejection, and the connection check
re-runs over them whenever the map grows. The unresolved `[[wikilinks]]` in the
vault are pre-made seed nodes: an idea named and never written up is a gap
declared in your own handwriting.

> **Revised.** LEARN-GRAPH-SPEC.md said "nothing is added without an edge", with
> no exception. The exception is authorship.

---

## When things disagree

The highest-value thing the map can do, and the easiest to make useless, because
**most apparent contradictions are not contradictions.** A system that cries
conflict at every pair of nuanced statements gets ignored within a week. So the
first job is triage, not resolution.

### Six kinds

| what it actually is | example | what happens |
| --- | --- | --- |
| **Scope mismatch** — both true, different conditions | "Minimum wages cut employment" / "Card–Krueger found no effect" | Not a contradiction. Add the missing condition to each. This is what "it depends" means, spelled out. |
| **Level mismatch** — true at different altitudes | Individually rational, collectively ruinous | Not a contradiction. Link `example-of` and name the level each speaks to. |
| **You changed your mind** | A 2023 note says X, a 2026 note says not-X | A fact about you, not about the world. Supersede, and keep the old one. |
| **A live dispute in the field** | Two credible economists genuinely disagree | Not an error — a property of the subject. Keep both, record who is on each side and what the crux is. Knowing a field's open fights *is* being sharp about it. |
| **You are inconsistent** | You hold two things that cannot both stand | The gold. Pick, or find the distinction that saves both. |
| **One is simply wrong** | Bad source, misremembered | Retract it. It becomes a misconception record with the evidence attached. |

Only two of the six are real contradictions. The other four are clarifications
wearing a contradiction's clothes, and surfacing them is arguably worth more —
scope and level are exactly where an amateur take falls apart.

### How one is found

Three moments, all cheap:

- **At extraction.** The reconcile pass already compares each candidate against
  what exists. Things that are *highly similar but opposed* fall out of the same
  comparison for nothing.
- **At probe time.** You answer in a way that cuts against a stored position.
  The sharpest signal there is, because it is you contradicting you, live.
- **On a sweep, within neighbourhoods only.** All-pairs does not scale — 500
  nodes is 125,000 comparisons — and it does not need to: contradictions live
  close together in the graph.

### What the app does about it

**It does not resolve it.** The model is not the arbiter of what you believe,
and a system that quietly decides which of your two beliefs wins is worse than
no system at all.

It presents both nodes, where each came from, which of the six kinds it looks
like, and a proposed **crux** — one sentence naming what the disagreement turns
on. You decide.

The resolution is **not a deletion**. It is a new node: the condition or
distinction that separates them.

> **A** (a 2024 note): *Upzoning lowers rents.*
> **B** (a later clipping): *New luxury buildings are associated with rising
> neighbourhood rents.*
>
> Scope plus level: metro-wide supply effects over years, against local
> selection effects — new buildings go up where demand is already climbing.
>
> **Resolution:** *Upzoning lowers rents metro-wide over years; new construction
> correlates with local rent rises because it is built where demand is rising.*
>
> The resolution is a new node, joined to both originals by `qualifies`. That
> edge type exists because of this procedure: a scope or level mismatch always
> resolves into a boundary, and a boundary needs somewhere to attach.

That third node is worth more than either of the first two, and producing it is
the move that separates somebody who has read about housing from somebody who is
sharp about it.

### Consequences in the data

- An **open contradiction drops both nodes from `known` to `shaky`.** You do not
  know something you contradict yourself about, and the map should not pretend.
- **Superseded nodes are never deleted** — they carry `superseded_by`. What you
  used to think is among the most interesting things the system will hold, and
  it is what lets it say "you changed your mind about this in March, and here is
  what moved you."
- A disagreement is **its own row**, not a flag on an edge, because it has a
  lifecycle: `open`, `resolved`, `live_dispute`, `superseded` — plus the crux,
  the resolution, and a date.
- A dismissal is **permanent**. "Not a contradiction" is remembered forever and
  that pair never surfaces again. A tension you have already dismissed coming
  back is the fastest way to make the feature feel stupid.

---

## Provenance and state

Two different things that are easy to conflate.

**Provenance** is where a node came from: `extracted` (a model read it in a
note), `authored` (you typed it), `generated` (produced when a goal was
expanded). It decides the orphan rule and it is shown on the node.

**State** is how well you hold it, and vault-derived state is never `known`:

| state | means |
| --- | --- |
| `claimed` | your notes say you have this. A hypothesis, not a finding. |
| `shaky` | tested and wobbly, or currently inside an open contradiction |
| `known` | tested and held |
| `misconception` | tested, and wrong in a specific, named way |

Everything the vault pass produces lands at `claimed`. Probing is the only thing
that promotes it. This matters: a map that tells you that you know 400 things
because you once saved an article is a flattering map, and a flattering map is
useless for deciding what to learn next.

---

## The procedure

What actually runs, in order. Stages 0 to 3 are the first build; 4 to 7 follow
immediately but are separable.

### Stage 0 — Classify

Every note is classified, and almost every note is read. One cheap call each,
over the first ~1,500 characters, returning one of four:

| class | what happens |
| --- | --- |
| `knowledge` | goes to extraction |
| `mixed` | goes to extraction |
| `evidence` | no concepts, but it raises confidence in concepts found elsewhere — coursework, transcripts, a CV, an application describing what you can do |
| `operational` | skipped: logistics, meeting arrangements, task lists, contact details |

**There is no folder routing, and that is a decision the trial forced.** The
original design excluded whole paths — `Me/`, applications, anything that looked
personal — on the reasoning that a folder is a free, predictable filter. Two
findings killed it:

- `Me/People/Chewy.md` is a note about a conversation with a friend, full of
  wedding logistics and a phone call from his dad. It also contains *"cities
  should be built for people, not cars — even if that costs efficiency,
  efficiency is not the goal, the same way runs are not the goal in
  sabermetrics"*, which was one of the three best nodes in the whole sample.
  The folder rule would have thrown it away.
- A dated Armodafinil dosage log sat in an *included* folder and produced
  nothing, because the **node test** rejected all of it.

The node test is a better filter for personal content than a folder is, and it
is better in both directions — it keeps the good line in the personal note and
it drops the log in the knowledge folder. Folders in this vault were never
maintained as a taxonomy, which is the usual case and the reason folder rules
look cheap and are not.

**The one exclusion that stays is the journal**, and it is excluded on privacy
rather than on yield: there is no reason to send it anywhere. It is identified
by an explicit list you control, not inferred.

### Stage 1 — Chunk

Split each note on headings. Sections under ~200 characters merge into their
neighbour; sections over ~4,000 split on paragraph boundaries. Extraction runs
per chunk, so a 20,000-character essay is not asked to surrender its ideas in
one breath.

> **Revised.** LEARN-GRAPH-SPEC.md implied a fixed budget of about three
> concepts per note. That is wrong for a dense note. What actually needs
> guarding against is not volume but **restatement** — the same idea pulled out
> five times in slightly different words — and reconciliation (Stage 2) catches
> that far better than a cap ever could. If a long essay genuinely contains
> fifteen distinct positions, take fifteen.
>
> **There is no characters-per-concept guideline either.** An earlier draft
> offered one concept per 800–1,200 characters as a sanity check. The trial
> found observed density spanning **290x** — 181 characters per node in a
> distilled economics course note, 52,937 in a case-prep research dump. Length
> predicts nothing. Note *type* predicts almost everything, and the classifier
> in Stage 0 is where that belongs.

### Stage 2 — Extract

One call per chunk. Haiku, tool-shaped output, returning candidates:

- `name`, `kind`, `statement`
- `evidence` — the sentence in the note that supports it, verbatim
- `stance` — did the writer appear to **hold** this, or **encounter** it? A note
  you wrote in your own words is evidence you hold a position. A clipping is
  evidence you were interested, which is a different and still useful fact.
- `confidence`
- candidate edges **within this chunk**: a type from the six, and a one-line
  description of what the relation actually is

Every candidate must pass the node test. The prompt states it as a refusal: if
you cannot write a question that separates somebody who holds this from somebody
who does not, do not return it.

### Stage 3 — Reconcile

The stage that decides whether the map is 400 nodes or 3,000.

1. **Block on lexical similarity** — Postgres trigram matching over names and
   statements — to get a small set of candidate matches per new node. This is
   SQL, not a model call, and it removes ~99% of the comparison space.
2. **Adjudicate in batches.** One call per twenty candidate pairs, returning
   `same` / `different` / `opposed` for each. Batching is what keeps this cheap;
   one call per pair is the version of this stage that costs more than
   everything else combined.
3. **Act.** `same` merges, keeping both sources on the surviving node.
   `different` creates. **`opposed` creates the node and opens a disagreement
   row** — this is where most contradictions are found, for no extra spend.

Embeddings are deliberately not used in the first build. Trigram blocking plus
model adjudication needs no new vendor (Anthropic does not serve embeddings) and
is likely good enough at this size. If the merge rate proves bad, the upgrade is
`pgvector`, which Supabase already ships, with Voyage for the embeddings — one
stage changes, nothing else does.

### Stage 4 — Edges across notes

Three sources, in order of how much they are trusted:

1. **Your wikilinks.** If node A came from note N, node B came from note M, and
   N links to M, that pair is a strong edge candidate. **2,791 of these already
   exist.** You drew them. The model's job shrinks to naming which of the six
   types it is and describing it in a line, which is a much easier question
   than inventing the relation from nothing.
2. **Co-occurrence** within a chunk, already captured in Stage 2.
3. **Inference** within a neighbourhood, for the rest.

Then the DAG check: any `requires` edge that would close a cycle is refused by
the database.

### Stage 5 — Disagreements

Sweep within neighbourhoods for the kinds that Stage 3 could not see — the ones
where the statements are not lexically similar but the positions still collide.
Each one gets classified into the six kinds and given a proposed crux.

### Stage 6 — Centrality

Compute the score for every node, store it, recompute when edges change. Plain
graph arithmetic, no model.

### Stage 7 — Review

What survives goes to a queue. Accept, merge, reject, one tap each, highest
centrality first so the decisions that shape the map come before the ones that
do not.

The principle this stage exists to serve, and the answer to *rigid or adaptive*:
**the model proposes, the structure constrains, you arbitrate.** Not "the AI
decides" (drift, and a map you do not trust) and not "you maintain a taxonomy"
(work, and it stops after a fortnight). Ten seconds a day, and the map stays
yours.

The same rule governs everything afterwards: **the map never silently
reorganises itself.** Restructuring is always a proposal you accept.

---

## What a new idea does to an existing map

Three cases, deliberately handled differently:

- **It fits and the map did not know.** Attach it. Routine, silent.
- **It collides with something already there.** Do not overwrite — open a
  disagreement and surface it. That is a card in the daily loop, and resolving
  it is a genuine event rather than a database update.
- **It is new territory.** It becomes a seed node. When three or four seeds
  start clustering, that is a new area emerging, and the system says so rather
  than declaring it.

---

## Cost

Estimates, to be checked against the spend ledger rather than trusted. Haiku
throughout; Sonnet for extraction roughly triples the extraction line.

| stage | rough cost |
| --- | --- |
| Classify 1,244 notes (first 1,500 chars each) | ~$0.60 |
| Extract from what classifies as knowledge or mixed | ~$2.00 |
| Reconcile, batched twenty pairs per call | ~$0.30 |
| Edges and disagreements | ~$0.50 |
| Centrality | free |
| **First full build** | **under $6** |

Unverified. The 30-note trial was run by hand rather than through Haiku,
because the sandbox it ran in had no API key, so nothing here has been measured
against a bill. The spend ledger exists so that the first real run replaces this
table with facts.

Incremental syncs are a fraction of that, because only changed notes are read.

---

## What "it worked" looks like

Agreed before anything runs, so the result can be judged rather than admired.

- **1,500–2,500 concepts** from 1,244 notes. Under 800 means the bar is too
  high and it is only catching the obvious.

  > **Revised after the trial.** This said 300–600, and called anything over
  > 2,000 a hairball. The sample projects to 1,600–1,800 after reconciliation,
  > so on the old number the trial failed. The old number was wrong: it
  > conflated **the map** with **the view**, and centrality already separates
  > them — a 2,000-node map whose top 150 you actually look at is not a
  > hairball. Size only hurts in one specific place, which is the frontier
  > computation getting crowded by trivia, and the fix for that is a
  > **centrality floor on the frontier query**, not a smaller map.
- **Under 15% of extracted candidates rejected as orphans.** More than that and
  edge extraction is the weak half, not node extraction.
- **Every node traceable** to at least one note and one verbatim sentence.
- **Nothing at `known`.** The whole vault pass should land at `claimed`.
- **At least a handful of disagreements**, and on inspection most of them should
  be scope or level mismatches rather than real contradictions. If they are all
  flagged as genuine conflicts, the classifier is too eager.
- **The edge types should be spread, not collapsed.** If nearly everything is
  `example-of`, typing is not happening and the descriptions are where to look
  for why. `requires` should be the rarest of the six by a wide margin.
- **The top twenty by centrality should be recognisable** as the things you
  actually think about. If they are not, the map is wrong in a way no metric
  will catch, and that is the real test.

---

## The 30-note trial

Before the full pass, run Stages 1–3 over a stratified sample: ten from `Bulk`,
ten from `Pending`, five from `Me` or `Yale`, five picked at random from the
rest. Cost is a few cents.

What to look at, in order:

1. **Are the nodes positions, or are they topics?** The single question that
   decides whether any of this works. A list that reads like a table of contents
   is a failure however tidy it looks.
2. **Is `stance` right?** Does it correctly tell a note you wrote from a page you
   clipped?
3. **How many duplicates survive reconciliation** across the thirty.
4. **Do the edge types mean anything**, or is everything `example-of`?
5. **Does routing behave** — did anything personal make it through?

Any of those failing changes the design before $5 is spent on the wrong shape.

# Learn: the pipeline

How the Learn module works end to end, as one flow rather than four documents
written at different times.

This is an index over the specs, not a replacement for them:
[LEARN-SPEC.md](LEARN-SPEC.md) is the reading side,
[LEARN-GRAPH-SPEC.md](LEARN-GRAPH-SPEC.md) is what you know,
[LEARN-MAP-SPEC.md](LEARN-MAP-SPEC.md) revises parts of that document for the
vault, and [LEARN-SOURCES-SPEC.md](LEARN-SOURCES-SPEC.md) is the catalogue. Each
says what its own piece does. None of them says what happens between the pieces,
which is where the module is actually incomplete.

Each stage below says what it hands on. That contract is the useful part: a stage
can be rebuilt freely, and a broken handoff is what makes the module do nothing.
Questioning is the exception and has no position, which is the point of it.

Written to [WRITING-GUIDE.md](WRITING-GUIDE.md).

---

## The seven stages

Six of them form a loop. The seventh, questioning, is not a position in it.

| # | stage | the question it answers | specified in | state |
| --- | --- | --- | --- | --- |
| 1 | What you know already | what do I hold, and how well | GRAPH, MAP | three routes built, the largest one unbuilt |
| 2 | What you want to know | which subjects am I in | GRAPH | built, and heavier than it needs to be |
| 3 | The curriculum | in what order | GRAPH, SPEC | baseline built, adaptation built, no external skeleton |
| 4 | The suggestion engine | what is the one next thing | GRAPH | built |
| 5 | The sources | where do I go and learn it | SPEC, SOURCES | store built, no ingest, two rival mechanisms |
| 6 | Back into what you know | what did that change | GRAPH | built for probes, missing for readings |
| — | **Questioning** | show me you hold it | GRAPH | six entry points, no rule about which answers count |

**Questioning happens at any time, from anywhere, and is not a stage.** It is an
operation available against any claim, and the module already works this way at
six surfaces: one of them runs before a subject row exists, and another never
touches the graph at all. Putting it between the sources and the feedback would
say you have to go and fetch something before you can be asked, which is both
false and not wanted.

It is also not a line. Stages 1 and 6 write the same two tables, which is what
makes this a loop with a bootstrap rather than a pipeline that finishes.

---

## 1. What you know already

**For.** One row per claim in `learn.concept_state`, saying which of six states
you are in and on what basis. This is the store the whole module is built to
keep honest, and the rule that keeps it honest is that nothing arrives at
`known` without having been asked.

| state | means |
| --- | --- |
| `unknown` | nothing has established it |
| `shaky` | tested and wobbly |
| `recognised` | picked it correctly out of four |
| `known` | applied it to a case |
| `sharp` | defended it |
| `misconception` | wrong in a specific, named way |

`established` says how: `tested`, `inferred` (something above it was answered),
or `declared` (you said so). A screen that renders those three identically is
overstating two of them.

**What exists.** Four routes in, of very different reach:

- **The opening sweep** (`opening_sweeps`, `opening_questions`, and
  `lib/learn/graph/opening*.ts`). Ten written questions asked before a subject
  is built. A sweep exists before any subject row does, so the claims are
  carried as text and the subject id is stamped in when a chain is approved.
  This is the best thing in the module and the least obvious from the specs.
- **Told directly** (`lib/learn/graph/from-prior.ts`, `/learn/know`). You write
  an account, or paste an essay or a syllabus, and Sonnet turns it into a
  proposed chain. Written because every other route waits for you to do
  something and none of them can reach the years before the app existed.
- **A probe result**, which is the only route that writes `tested`, and which can
  arrive at any time from any of the six surfaces below.
- **The vault**, which is `lib/learn/vault/classify.ts` and nothing else.

**Hands on.** `concept_state` rows, and through `lib/learn/graph/rooting.ts` two
lists: `settled` (what a source may assume, capped at 30) and `frontier` (the
unsettled claims with nothing unsettled underneath, capped at 8).

**Missing.** The vault pass is stage 0 of the eight LEARN-MAP-SPEC describes.
Classification works; chunking, extraction, reconciliation, the wikilink edge
prior, centrality and the contradiction sweep are all unbuilt. That document
budgets about a dollar in Haiku input tokens for 1,244 notes and 4.48 million
characters, so the constraint was never cost. This is the largest single piece
of unbuilt work in the module, and it is what would take the graph from empty to
a few hundred claims without asking you to type anything.

---

## 2. What you want to know

**For.** Naming a subject, so there is somewhere for claims to live and
something for the suggestion engine to sort.

**What exists.** `learn.subjects`, one row per subject per account, unique on
lowercased name so `economics` and `Economics` are one subject. The bar is
whether one survey course could plausibly cover it: `Economics` works, `Science`
does not, because the claims of science have no prerequisite relationships with
each other and a graph with no edges makes every ordering rule downstream do
nothing. That judgement is not enforceable in SQL and is not attempted.

`learn.goals` holds a more specific want: what you typed, the concept it
resolved to, and its status. Naming a goal is the first of the five growth
triggers, and it generates only the missing chain rather than a whole subject.

**Hands on.** A subject id, and optionally a goal that gives stage 4 something
to measure distance to. `ReadyConcept.stepsToGoal` is null when no goal sits
above a claim, and the ordering degrades to "everything is equally ready".

**The friction worth naming.** Saying "economics" should be enough, and today it
is nearly enough: the opening sweep is exactly that path, and being asked ten
questions is a better way to find out what you know about a topic than being
asked to describe it. But ten written answers before anything exists is a real
gate, and a subject created with no sweep gets no baseline at all, which leaves
stage 4 sorting a flat list.

Worth deciding: whether a subject can be created bare, get a generated chain
with everything at `unknown`, and have its sweep offered later as an ordinary
row on `/learn/next` rather than as a wall at the start. That keeps the sweep,
which is good, and stops it being the price of admission.

---

## 3. The curriculum

**For.** An order. Two halves, and they are different mechanisms.

**The baseline.** A generated chain, from a goal or from a sweep, approved by you
before any row is written. `learn.concept_edges` holds prerequisite to
dependent, acyclic, enforced by a database trigger rather than by convention,
because the acyclic property is what every ordering rule below depends on and a
property the application merely promises is one you find out about from a page
that never loads.

`learn.concepts.kind` marks a claim `threshold` or `consequence`, after Meyer and
Land: a handful of ideas in any subject are the doors, and the rest are
downstream. Nullable on purpose, because a default would assert something nobody
judged.

**The adaptation.** Five growth triggers, from GRAPH-SPEC: you name a goal; a
probe finds a floor you do not have; a probe finds you already know something
above; a reading introduces a claim the graph lacks; you ask for depth. Two
rules stop this becoming a blob. Nothing is added without an edge, and pruning
happens at view time rather than write time, so the graph can reach hundreds of
nodes while any one screen stays a dozen.

`learn.tracks` plus ordered `learn.readings` is the other curriculum, at a
smaller grain: a question you were stuck on, and the sources that answer it in
order, each carrying a `why` saying what it gives you that the previous one did
not. That column is what makes an ordered list a curriculum instead of a pile.

**Hands on.** An order, and a frontier.

**Missing.** Every one of the five triggers is reflexive. Each starts from
something already in the graph or something you deliberately pointed at, so the
curriculum can only ever be as wide as what you have already met. Two things
would change that, both of them in stage 5: a published course order as a track
skeleton, and an external reference set for coverage.

---

## 4. The suggestion engine

**For.** One question, answered twice at different sizes.

**Across everything**, `/learn/next` and `lib/learn/next/rank.ts`: eight rows,
three kinds interleaved one at a time, each row saying in a line why it is
there. A claim you are ready for, ordered nearest to a goal first. A claim
settled over a month ago, longest unasked first. A reading you queued and never
opened, longest queued first. The three orders are not scored against each
other, because two steps from a goal and seven months unchecked are not
comparable numbers.

**Inside a session**, `lib/learn/graph/pick.ts`: the one claim a five-minute
session asks about. Every fifth turn goes back to the settled claim asked about
longest ago, and a re-check turn with nothing old enough falls through to an
ordinary question.

`learn.next_outcomes` holds what came of a row, and there are exactly three:
answered, read, pushed aside. Nothing records that a row was shown, clicked, or
looked at. That is a rule about this page rather than an omission, and it means
the ordering can only be computed from things you did on purpose.

**Hands on.** One claim, or one queued reading.

**What it does not do, deliberately.** There is no notion of which question
would resolve the most uncertainty. Nearest-to-goal is a curriculum ordering and
it is the right objective while a goal exists. It stops being the right one when
the vault lands and there are hundreds of claims with no goal above any of them,
which is when the phase machine from the mapper analysis becomes worth building
and not before.

---

## 5. The sources

**For.** Turning a claim into somewhere to go.

**What exists.** Two mechanisms, built eighteen months of design apart and not
reconciled.

The **locate** path, `lib/learn/locate/locate.ts`: you supply the source, and
when you open the reading a model finds the passage, whose anchor phrase is then
checked verbatim against the fetched document before the locator is called
verified. Lazy on purpose, because you will not read most of what you queue.

The **catalogue**, `learn.catalogue_*`, applied as `learn_0022_catalogue`: shared
reference data, seven providers seeded and all disabled, with a segment as the
addressable unit so a reading can point at `12:04–18:30` of a lecture. Retrieval
is nearest-neighbour over `vector(1024)` embeddings, then a model verdict that
writes the `why`. A link is never stored on similarity alone.

All fetching goes through `lib/learn/providers/`, which is eslint-enforced and
proved by `tests/lint-boundaries.test.ts`, because these are addresses that came
out of a model reading text a stranger wrote.

**Hands on.** A `sources` row materialised from a catalogue item, plus a
`readings` row with a locator.

**Missing, and the one to settle first.** `rooting.ts` builds a prompt-shaped
description of you, capped at 30 settled and 8 frontier claims, for a search
that reads prose. The catalogue answers the same question by embedding one
claim and ranking segments. These are two answers to "what should this person
read next" and only one of them should survive per surface. The reconciliation is
not hard and it is not written down anywhere: rooting is right when the question
is open-ended and a model is choosing, and retrieval is right when the question
is one claim.

Also missing: any ingest at all, courses as track skeletons, and the
subject-level links that coverage would read.

---

## Questioning, which is not a stage

**For.** The only thing that writes `tested`, and the only operation in the
module with no fixed place in the flow.

**What exists.** `learn.probes`, one row per question at any rung, kept in full
rather than collapsed into a score, which is what makes "you have been wrong
about this three times in four months" answerable.

| rung | what it asks | what a right answer writes |
| --- | --- | --- |
| `recognise` | pick it out of three or four | `recognised` |
| `apply` | a case with the numbers changed | `known` |
| `defend` | state the strongest objection | `sharp` |

One table for all three, because a row is already "one question about one claim
and what came back" and the rung only changes which columns carry it. Check
constraints refuse a row that is half of two rungs. `concepts.mastery` holds the
two to four checks for a claim, and a probe aims at one named check rather than
at the claim in general, so the next question has somewhere new to go.

Generation is Haiku, one claim in and one item out, carrying no conversation
history, which is the difference between a session costing twenty cents and ten
dollars.

### Six places a question can start

| surface | what it asks about | what exists first |
| --- | --- | --- |
| `/learn/opening/[id]` | ten claims across a subject, carried as text | nothing. No subject row exists yet |
| `/learn/now` | the one claim a five-minute session picks | a graph |
| `/learn/s/[id]/probe` | claims in one subject | a subject |
| `/learn/c/[id]` | one claim, on its own page | one concept |
| `/learn/quiz/new` | material you chose, notes or pasted text | no graph involvement at all |
| `/learn/today` | whatever the day's surface offers | varies |

The opening sweep and the standalone quiz are the two that settle the shape. The
sweep asks before anything exists, so its claims live as text and a subject id is
stamped in later by whoever approves a chain. The quiz is deliberately outside
the graph: its own header says a quiz over your interview notes stands on its own
and does not put one-off nodes into a subject that lives forever.

So questioning is already free-standing. What it is not yet is *ambient*: there
is no way to be asked from inside a reading, or straight after a clip, which is
the moment when being asked is worth the most and the only moment that gives the
reading verdict its "after" without scheduling anything.

### The real question is which answers count

Once a question can be asked anywhere, when to ask stops being interesting and
what an answer is allowed to write becomes the whole design. Today three kinds of
questioning write three different things, and the rule is nowhere:

| asked from | writes to the graph | writes `tested` |
| --- | --- | --- |
| a probe on a claim | yes, at the rung's state | yes |
| an opening question | a starting state, once a chain is approved | no |
| a quiz | nothing, on purpose | no |

Each of those is defensible on its own. Together they are three policies nobody
chose at the same time, and the gaps show: a quiz question that is plainly about
a claim in your graph, answered correctly, moves nothing. That is right if the
quiz was about interview prep and wrong if it was about the subject you are
studying, and no column records which it was.

The rule worth writing down is about the claim rather than the surface. An answer
counts toward `concept_state` when it was asked against a stored claim and aimed
at one of that claim's checks. An answer to a question written from loose material
does not, however much it looks like the same question, because nothing
established that it tested the same thing. That keeps the quiz honest, keeps the
sweep's answers as a baseline rather than as evidence, and gives a quiz a way to
promote a question later: attach it to a claim, and it counts from then on.

**Missing, beyond the above.** Nothing checks the marked answer. The generator has
two real guards, the `unusable` flag and the rule that the reason must stand
without pointing back at the options, and both catch incoherent items rather than
confidently wrong ones. The misconception guard looks like it covers this and does
not: it fires on the same wrong option twice, and the same model on the same claim
will mis-mark the same way twice. A systematic error walks through a guard built
for slips, and what it writes is a sentence about your mind that you will believe.

---

## 6. Back into what you know

**For.** Closing the loop, which is the reason the module is a loop.

**What exists.** A probe result writes `concept_state` at the rung's state with
`established = 'tested'` and a `tested_at`. Two answers to the same wrong option
produce a named misconception through `lib/learn/graph/misconception.ts`, which
is allowed to decline when the two wrong answers do not add up to a coherent
belief, because a made-up misconception is worse than none. A result that finds
a missing floor or a known ceiling is triggers 2 and 3, and goes back to stage 3.
`next_outcomes` feeds stage 4.

**Hands on.** Everything, which is the point.

**Missing.** The reading half of the loop does not exist. A reading can be marked
read, and that records that you read it. Nothing asks afterwards whether it
worked, so a source that reads well and teaches nothing is indistinguishable from
one that lands.

Because questioning is ambient, the fix is smaller than it looked. It does not
need a scheduled re-probe row. It needs the entry point that is missing anyway:
being able to be asked from inside a reading, or as the clip ends. The snapshot
before and the answer after fall out of that, and the same entry point is worth
having on its own.

---

## Where the pipeline actually breaks

Ranked by how much each one stops the module working at all.

1. **Nothing has run.** Every table in `learn` is empty except `sources` at ten
   rows and the providers seeded last commit. The stages are individually built
   and the flow has never been exercised end to end with real data, so every
   handoff below is theoretical until a subject exists.
2. **The vault is one stage of eight.** Stage 1's only route that does not
   require you to type is a classifier with nothing downstream of it.
3. **No probe verification.** Questioning can write a false `misconception`, which
   is the worst output the module has.
4. **No rule about which answers count.** Three kinds of questioning write three
   different things to `concept_state` and nothing states the policy, so a quiz
   question that plainly tests a claim in your graph moves nothing.
5. **Two rival source mechanisms.** Stage 5 has rooting and retrieval and no rule
   saying which surface uses which.
6. **No reading verdict, and no way to be asked from inside a reading.** These are
   one problem: the missing entry point is what would give the verdict its
   "after".
7. **No external reference.** Every growth trigger is reflexive, so blind spots
   are structurally invisible.
8. **The sweep is a gate.** Stage 2 asks for ten written answers before a subject
   exists.

---

## Where the specs and the schema disagree

Worth knowing before reading either as authoritative.

- **Subjects.** LEARN-MAP-SPEC says subjects should be labels rather than
  containers, one graph with tags. The schema still has `concepts.subject_id` as
  structural, because `concept_edges` uses it to require both ends of an edge to
  be in one subject through a foreign key rather than a check. `concept_subjects`
  (0020) bought the half the vault needs and its own header says the full change
  is a refactor of 31 files.
- **What a node is.** GRAPH-SPEC says one claim you can be right or wrong about.
  MAP-SPEC widens it to a position you could hold, with four kinds: `claim`,
  `position`, `distinction`, `frame`. The schema has neither list. Its
  `concept_kind` is `threshold` or `consequence`, which is a different axis
  entirely: MAP's kinds say how a claim is probed, and the schema's says where it
  sits in a subject. Both are probably wanted, and nothing says so yet.
- **Edge types.** MAP-SPEC specifies six. The schema has one, prerequisite,
  plus `concept_mentions` as an untyped aside that nothing walks.

---

## Decisions this breakdown surfaces

1. Can a subject be created bare, with its opening sweep offered later as a row
   on `/learn/next` instead of a gate?
2. Which surfaces use `rooting.ts` and which use catalogue retrieval?
3. Does probe verification run on every generated probe or on a sample?
4. Which answers count toward `concept_state`? The proposal above is that it
   turns on whether the question was asked against a stored claim and aimed at
   one of its checks, never on which page it was asked from. That would let a
   quiz question be promoted later by attaching it to a claim.
5. Do MAP-SPEC's four node kinds and the schema's `threshold`/`consequence` both
   land, as two columns?
6. Is the next build the vault (stages 1 to 7 of MAP-SPEC) or the Wikipedia
   ingest (stage 5)? The vault fills the graph, which every other stage is
   waiting on. The ingest is smaller and its value depends on there being claims
   to link to.

On 6, the vault comes first. Four of the seven breaks above are downstream of an
empty graph, and the catalogue cannot be judged useful until there is something
for it to point at.

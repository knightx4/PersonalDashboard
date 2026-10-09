# Learn: topics and levels

How Learn records what you know. It uses one shared map of topics, ten fixed
levels of depth on every topic, and an inference rule: showing a level also
shows everything that level rests on.

This replaces the unit [LEARN-GRAPH-SPEC.md](LEARN-GRAPH-SPEC.md) built on,
which was one claim with one state, tested on its own. The probing, the vault
map and the catalogue all stay. The section "What this revises" lists what
changes in the other specs.

Written to [WRITING-GUIDE.md](WRITING-GUIDE.md).

---

## The problem with one claim at a time

Two things the person asked for on 9 October 2026 cannot be expressed in the
claims graph.

**Showing something hard should settle the easy things under it.** If you can
explain CAPM in depth, the app should stop asking what a return is. In the
claims graph a right answer marks only the claim's direct prerequisites
`inferred`, and only within one subject. Nothing reasons that someone who can
explain CAPM holds the whole cone of ideas beneath it.

**A topic has depth, and the depth is where the interesting learning is.**
Knowing what a DCF is and knowing how terminal value assumptions dominate a
DCF of a high-growth company are two depths of one topic. In the claims graph
they are either one claim or two unrelated ones. So the app cannot say "you
have DCF to level 6; level 7 is next", which is what a well-informed tutor
would say.

The structure below addresses both. It comes from knowledge space theory
(Doignon and Falmagne, 1985), the model behind ALEKS. That theory treats what
someone knows as a region of a map that is closed downward. If you hold an
item, you hold everything it requires.

## Decisions this rests on

Taken with the person on 9 October 2026:

1. **Ten fixed levels on every topic.** Every topic uses the same ladder, so
   levels can be compared across topics and fields.
2. **One map, shared across subjects.** A topic such as Return exists once.
   Evidence about it counts wherever it appears.
3. **Explanations are the main input.** You explain something in your own
   words, and the grader reads the answer against several levels at once.
   Multiple choice survives as a quick check on inferred levels.

## Topics

A topic is something you would name when saying what you know: Return, Beta,
CAPM, DCF, WACC, Braess's paradox, single-stair buildings. There is one map of
topics per account. A subject does not contain topics; it is a view over them
(see "Lenses" below).

A topic carries:

- `name`, and a one-sentence `scope` saying what it covers and what it leaves
  to its neighbours. The scope is what deduplication matches on.
- Zero or more fields from [LEARN-AREAS-SPEC.md](LEARN-AREAS-SPEC.md). Fields
  are tags, as subjects already are in the map spec.
- A `ceiling`: the highest level that has real content for this topic. "What a
  return is" has nothing at level 10. CAPM does. Levels above the ceiling do
  not exist for that topic, and nothing counts them.
- Ten `cells`, one per level up to the ceiling, described next.

Topics form no hierarchy. There is no parent topic and no category tree, for
the reason the map spec gives: a stored hierarchy has to be maintained and
goes stale. Topics relate only through requirement links between their cells.

LEARN-MAP-SPEC says a shelf label such as "behavioural economics" is not a
node because it cannot be probed. A topic name is a label of that kind, and
nothing probes the name itself. What gets probed is a cell, and each cell's
descriptor must pass the map spec's two tests: an answer could meet it or fail
to, and failing it would cost you something.

## The ten levels

The ladder is the same on every topic. Each level is defined by what you can
do, so that the grader can find evidence for it in an answer.

| band | level | you can | DCF |
| --- | --- | --- | --- |
| Aware | 1 | place it: what field it is in, what it is for | a way of valuing a company |
| | 2 | define it accurately in your own words | value is the discounted sum of future cash flows |
| Working | 3 | explain how it works: each part and why it is there | why free cash flow and not earnings, why discount, what terminal value stands for |
| | 4 | do it on a clean, given case | build one from given projections |
| | 5 | do it on a real case, choosing the inputs yourself | value a listed company from its filings |
| Fluent | 6 | judge the output: what drives it, whether it is sane | sensitivity tables, a cross-check against multiples |
| | 7 | name its limits: assumptions, failure modes, what to use instead | terminal value share, companies with negative cash flow |
| | 8 | connect it: derive it, relate it to neighbouring topics | multiples as a DCF with the assumptions folded in |
| Expert | 9 | use the moves practitioners use that most people do not know | reverse DCF to find the growth the price implies |
| | 10 | argue its live disputes and defend a position against the strongest objection | whether a DCF means anything for an early-stage company |

### Cells

A cell is one level of one topic. Its `descriptor` says what meeting that
level looks like for this topic, in two to four observable checks. "Can
explain why free cash flow is used rather than net income" is a check.
"Understands DCF well" is not, and drafting must reject it.

The descriptors are drafted by a model call (see "Drafting a topic"), approved
by the person, and editable. An edited descriptor records when it was rewritten,
the same as a claim does now.

A cell can also hold claims. These are the concepts the claims graph already
has, and the vault positions the map spec extracts. A claim attached to a cell
is material a question can be written from. It is not something tracked
separately: whether you know it is whether you hold the cell.

### Levels are not rungs

The claims graph has three rungs: recognise, apply, defend. A rung is a
question format. A level is a part of the topic. In this design the level
decides the format:

| levels | question | graded by |
| --- | --- | --- |
| 1 to 3 | explain | the grader, against several cells at once |
| 4 to 6 | a case to work: numbers or a situation, and you produce the answer | the grader, against the asked cell |
| 7 to 9 | explain | the grader, against several cells at once |
| 10 | defend: state a position, answer the strongest objection the app raises | the grader, against the asked cell |
| any, below what you have shown | multiple choice spot-check | code, by the index chosen |

The explanation at levels 4 to 6 is replaced by a case because explaining
something is weaker evidence than doing it. Someone can describe a DCF clearly
and still be unable to build one.

## Requirement links

Within a topic, every level requires the level below it. That is implicit and
never stored.

Across topics, a cell can require a cell of another topic, at a stated level:
CAPM 3 requires Return 2, Beta 2 and Risk-free rate 1. A link names the
**lowest** level the requiring cell needs. CAPM 3 needs to know what a return
is, and does not need the difference between arithmetic and geometric means,
which is Return 4. Getting this wrong in the generous direction is the
mistake that matters, because an over-high requirement would imply things you
were never shown.

A link from a cell holds for every higher cell of the same topic too, through
the in-topic chain. So CAPM 7 never needs its own link to Return 2.

Links are acyclic across the whole map, enforced by a trigger as
`concept_edges` is now. Each link carries an optional sentence saying why,
drafted with the topic and shown on the cell.

## What you know

### Evidence

Only three things write evidence about a cell, each a row in
`cell_evidence` with the date:

- **met**: a graded answer met the cell's descriptor, with the quote that
  shows it.
- **not met**: a graded answer to a question asked *about this cell* did not
  meet it.
- **declared**: you said you already know it, without being asked. This is
  the existing "waved through", now at a level.

A multiple-choice spot-check writes `met` or `not met` on the cell it was
about.

Nothing else writes evidence. The vault map does not, which keeps the rule in
[KNOWLEDGE-SPEC.md](KNOWLEDGE-SPEC.md) that knowledge is only written by you
answering something.

### Status, computed on read

Each cell's status is worked out from the evidence and the links whenever it
is read, by a pure function with no model call, in the style of
`lib/learn/graph/model.ts`. Nothing stores a status. That keeps inference
from going stale when a link or a descriptor changes.

| status | meaning |
| --- | --- |
| `shown` | its latest evidence is `met` |
| `implied` | no evidence of its own, and some `shown` or `declared` cell requires it, directly or through other cells |
| `declared` | its latest evidence is `declared` |
| `missed` | its latest evidence is `not met` |
| `open` | none of the above |

"Held" means `shown`, `implied` or `declared`. The screens show which one,
because "you explained it", "you explained something that needs it" and "you
said so" are different amounts of evidence.

**Your level on a topic** is the highest level L for which cells 1 to L are
all held. A topic where you hold 1 to 5 and 7 is at level 5, and the screen
shows 7 as held above a gap.

### When evidence disagrees

Suppose you are shown at CAPM 3, which implies Return 2, and then a spot-check
on Return 2 comes back `not met`. Either the CAPM grade was generous or the
link is wrong. The rules:

1. The miss stands for Return 2. A cell's own evidence always beats
   implication, so Return 2 reads `missed`.
2. CAPM 3 stays `shown` but is marked **in doubt**. The next question on CAPM
   re-asks level 3.
3. If CAPM 3 is shown again while Return 2 is still missed, the link is
   probably wrong. It is listed for review on the topic page with both
   answers quoted. The person decides whether the link goes.

This is how the map corrects its own inferences instead of trusting them
indefinitely.

### Re-checks

The existing rule carries over at the new grain. One question in five goes
back over a held cell that has gone more than 30 days without evidence. It
asks about the **highest** held cell on a topic, because that one answer
re-tests the cone beneath it. Nothing decays on a timer, as in the graph spec.

## How answers are graded

### Explanations

The grader is one model call. It receives:

- the question and the answer;
- the descriptor of the asked cell;
- the descriptors of the cells two levels above and below it on the same
  topic;
- the descriptors of every cell the asked cell requires, at their linked
  levels.

For each of those cells it returns `met`, `not met` or `not touched`, and for
each `met` the span of the answer that meets it.

Code then applies three rules before anything is written:

1. A `met` without a quote that appears verbatim in the answer is dropped.
   This is the same verified-quote discipline the map spec uses for positions.
2. `not met` is written only for the asked cell. An explanation of CAPM that
   does not mention the Sharpe ratio has not failed anything about the Sharpe
   ratio.
3. `not touched` writes nothing.

So one good explanation can show several cells, and one weak one can only
miss the cell it was asked about.

The answer screen lists every cell the answer reached, each with its quote.
That list is the "it took what I said to heart" moment, and it must say why.

### Cases and defences

A case at levels 4 to 6 is written against the asked cell's descriptor and
carries the answer it expects, as the applied rung does now. The grader
returns `met` or `not met` for that cell alone. A defence at level 10 is
graded on whether the answer engaged the objection and held or revised the
position for a stated reason. The rule for writing that objection is the
graph spec's open question on the defence rung, and this spec does not
settle it.

## Choosing the next question

### Placement

When you start on a topic with no evidence, the first question goes high and
the next ones bisect:

1. Start at the level halfway between the highest held level and the
   ceiling. With nothing held, that is level 5 on a ten-level topic.
2. `met` moves the range up to between this level and the ceiling; `not met`
   moves it down.
3. Stop when the gap between the highest held level and the lowest missed
   level is one.

That places you on a ten-level topic in about four questions. An explanation
that meets several cells can end placement early. Because links imply cells
on other topics, placing you on CAPM also places you partly on Return and
Beta before either is asked about.

### After placement

The flow asks about the cell that would settle the most. For each candidate
cell, count the open cells that become implied if it is met, and the cells
above it that would be ruled out for now if it is missed. Ask the cell whose
smaller count is largest. This is the cell that splits the uncertainty most
evenly, and it is a few hundred integer sums per question, in code.

Placement, re-checks and fringe questions share the flow in the proportions
Practice Flow already uses. Re-checks are one in five. The track weights in
`lib/learn/flow/interest.ts` decide which topic each ordinary question comes
from.

## What to learn next: the fringe

The **fringe** is every open or missed cell whose level below is held and
whose required cells are all held. It is the set of things you are ready for,
by construction, so readiness is never something the ranking has to guess.

The fringe has two directions, and the screen names which a row is:

- **Deeper:** the next level of a topic where you already hold level 1. DCF 7
  when you hold DCF 6. This is where the material that most people never
  reach sits.
- **Wider:** level 1 or 2 of a topic you hold nothing on, which your
  held cells have just made reachable.

Ranking within the fringe, in order:

1. Cells inside a lens you are working towards, below its target (see
   "Lenses").
2. The interest weights the flow already keeps per track, and the vault
   theme strengths from KNOWLEDGE-SPEC.
3. **Unlock count:** how many other cells would join the fringe if this one
   were held. A cell that opens eight others outranks one that opens none.

Every fringe row says in one line why it is there, as every row on Learn's
lists already does. Material for a fringe cell comes from the catalogue and
the reading queue, searched with the cell's descriptor in place of a claim.

## Lenses: subjects and goals

A **lens** is a named set of topics, each with a target level. Subjects and
goals both become lenses.

- *Corporate finance*: DCF to 7, WACC to 6, Return to 4, CAPM to 6.
- *Familiar with all 1,000 level-3 Wikipedia articles*: a thousand topics,
  each to level 2.
- *Solid on startup FP&A*: a dozen topics, mostly to 5 or 6.

A lens has no topics of its own. Topics belong to the shared map, so explaining
CAPM moves every lens that includes CAPM.

**Progress on a lens** is the number of held cells at or below each target,
over the number of cells at or below each target. That is a real fraction,
because a lens is a finite list. Adding a topic to a lens lowers it, and the
lens page says so on the day it happens. This replaces the information-weight
bar for lenses. The graph spec's bar existed because there was no fixed list
to count against, and a lens is one.

The Know page shows each field from LEARN-AREAS-SPEC by the mean level of the
topics tagged with it. That lets it show depth across a field, not only
whether the field has been touched.

## Drafting a topic

One model call drafts a topic when one is needed. That happens when you name
a goal, when an explanation leans on a topic the map does not have, or during
migration. The call returns:

- the name, scope, fields and ceiling;
- the descriptors for every level up to the ceiling;
- requirement links to existing topics, each at the lowest level needed, with
  a sentence saying why;
- names and scopes of missing topics that the links need. These are drafted
  by their own call only when you approve them.

Before you see the draft, its scope is embedded and matched against existing
topics. A close match is shown beside the draft, and you choose between
merging and keeping both. With one shared map, a duplicate splits your
evidence between two topics. Most of the cost of getting this wrong falls on
the inference rules, so the decision is the person's and is never made
automatically.

Nothing is asked about a drafted topic until it is approved, the same as for
the claims graph now. Each call's cost goes to the spend ledger in `core`.
The first twenty drafts are the measurement for the cost line this spec does
not yet have.

## Migration from the claims graph

On 9 October 2026 the live data held 106 subjects, 384 concepts, 158 edges,
94 concepts with a state other than unknown, and 26 probes. That is small
enough to migrate in one pass, with the person reviewing the result.

1. **Concepts to cells.** One call per subject assigns each concept to a topic
   (drafting the topic if none fits) and a level. The concept is attached to
   that cell as a claim.
2. **States to evidence.** `known` or `sharp`, tested, writes `met` at the
   concept's cell. `recognised` writes `met` only if the cell is level 1 or 2.
   At any other level it writes nothing, and the probe stays in the history.
   `shaky` and `misconception` write `not met`, and a named misconception
   stays on the claim. A declared state writes `declared`. `inferred` writes
   nothing, because implication is now computed.
3. **Edges to links.** An edge between concepts on different topics becomes a
   link between their cells. An edge within one topic is dropped, because the
   level chain covers it, unless it runs downwards (a prerequisite placed
   higher than its dependent). That edge is listed for the person to resolve.
4. **Subjects to lenses.** Each subject becomes a lens of the topics its
   concepts landed in. Each target is the highest level any of its concepts
   reached. The person can raise targets afterwards.
5. **Probes stay.** `probes` gains a `cell_id`, and every graded answer from
   now on also writes its `cell_evidence` rows.

The old tables are kept read-only until the new screens have replaced every
read of them. Then a later migration drops them. That drop is destructive,
so it waits for the person's go-ahead.

## Tables

In `learn`, with RLS on every table and composite foreign keys carrying
`user_id`, as in the rest of the schema.

| table | holds | source for Goals? |
| --- | --- | --- |
| `topics` | name, scope, ceiling, fields, scope embedding, draft or approved | yes: what the person studies |
| `topic_cells` | one row per topic and level: the descriptor, when it was rewritten by hand | no: part of the topic |
| `cell_links` | requiring cell → required cell, the sentence why, acyclic | no: structure |
| `cell_claims` | which claims (concepts, vault positions) are material for a cell | no: join rows |
| `cell_evidence` | met, not met or declared, the probe it came from, the verified quote, the date | yes: what the person did |
| `lenses` | a named set of targets, and whether it was a subject or a goal | yes: what the person wants |
| `lens_targets` | lens, topic, target level | no: part of the lens |
| `link_reviews` | a link in question, the two answers that put it there, and what the person decided | no: bookkeeping |

Statuses, levels, the fringe and lens progress are computed and never stored.

## Screens

| route | what it is |
| --- | --- |
| `/learn/t/[id]` | one topic: the ten-row ladder with each cell's status, its evidence and quotes, the links in and out, and the next cell |
| `/learn/lens/[id]` | one lens: each topic as a bar to its target, with progress and the fringe inside the lens |
| `/learn/know` | fields by mean level, and the lenses |
| `/learn/now?practice=1` | Practice Flow, now asking placement, fringe and re-check questions, with the answer screen listing every cell an answer reached |

At the end of a practice run, the flow lists what moved: cells newly shown,
cells newly implied, misses found, and any link put in doubt.

## Rules

**R1.** Only a graded answer or a declaration writes `cell_evidence`; nothing
read from the vault or the catalogue does.
Checked by: audit.

**R2.** A `met` verdict is written only with a quote that appears verbatim in
the answer it came from.
Checked by: audit.

**R3.** `not met` is written only for the cell the question was asked about.
Checked by: audit.

**R4.** Cell statuses, topic levels, the fringe and lens progress are computed
on read and never stored.
Checked by: audit.

## What this revises

- **LEARN-GRAPH-SPEC.** The six states give way to the five cell statuses.
  The three rungs become the question format a level calls for. Subjects
  become lenses. The information-weight bar gives way to lens progress. The
  one-in-five re-check, the rule that nothing decays, the probe record and
  the approval step all stand.
- **LEARN-MAP-SPEC.** Nodes and positions become claims attached to cells.
  The node test still applies, now to cell descriptors. The map spec's
  centrality stays as the zoom order for topics, computed over `cell_links`.
- **KNOWLEDGE-SPEC.** Unchanged. Implication is derived only from answers and
  declarations, so the vault still writes no knowledge.
- **LEARN-AREAS-SPEC.** Unchanged. Topics are tagged with its fields.

## Build order

Each slice is usable before the next starts.

1. **Tables and the pure model.** The tables above, with RLS, the acyclic
   trigger and the sources catalogue entries. Then the functions that compute
   status, level, fringe, the next question and lens progress, tested against
   maps written by hand. No model calls.
2. **Drafting a topic.** The call, deduplication by scope, and the approval
   screen. The topic page, read-only.
3. **Migration.** The five steps above, with a review screen for the edges
   and assignments the person needs to settle.
4. **Explain questions and the grader.** The grading call, the three rules,
   and the answer screen listing the cells reached.
5. **Placement and the fringe in Practice Flow.** Bisection, the
   most-settling question, the fringe ranking and the end-of-run summary.
6. **Lenses.** Subjects and goals as lenses, lens progress, and the Know page
   by field.
7. **Cases and defences.** Case questions for levels 4 to 6. Level 10 waits
   on the defence question below.

## Open questions

- **How far implication should reach.** As written, implication is
  transitive with no limit: CAPM 3 implies Return 2, which implies whatever
  Return 2 requires. A long chain of inferences is weaker than a short one.
  If the link reviews show distant implications failing more often than
  near ones, implication should stop after two links. That needs real data.
- **Writing the level-10 objection.** Carried over from the graph spec.
- **Topic definitions shared between accounts.** Descriptors for DCF are not
  personal, and the catalogue already carries no `user_id`. Topics stay per
  account until a second account exists to share with.
- **Life goals as lenses.** A goal on `/goals` that needs knowledge, such as
  a job move into FP&A, could name a lens. Whether the goals routine should
  draft that lens itself is for the goals spec to decide.

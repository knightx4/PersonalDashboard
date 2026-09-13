# Learn: what you know

The second half of the learn module. The first half ([LEARN-SPEC.md](LEARN-SPEC.md))
answers *where do I read this*. This answers *what do I actually know, what am I
missing, and what is the one next thing worth learning*.

It exists because the queue has a hole in it. A reading list is a list of things
somebody thought were good. It has no opinion about you. It cannot tell you that
you are about to read chapter 9 of a book whose chapter 3 you needed, or that
the reason a paper made no sense is a single idea from a level below that you
never picked up, or that the thing you are confidently wrong about is the reason
the whole area feels slippery.

The store that fixes that is a graph of concepts with prerequisites, plus a
record of which ones you have been tested on and how it went.

## The two levels

The mistake to avoid is treating "what you want to learn" as one thing. It is
two, and they behave differently.

**A subject** is the container. `Economics`. There is one graph per subject and
it lives forever. It starts sparse and gets denser every time you use it.

**A goal** is what you actually typed. `Keynesian economics`, or `the Phillips
curve`, or `economics, generally`. A goal is a node in a subject's graph, plus
the chain of prerequisites leading to it.

You type whatever you want, at whatever level you want. The system works out
which subject it belongs to and puts it there. Name the Phillips curve and it
does not build a Phillips-curve graph — it works out that this is economics,
and builds the chain leading to that node inside your one economics graph. Name
Keynesian economics next month and two thirds of that chain already exists; it
adds the dozen nodes that do not and connects them.

So bigger *is* better, but it applies to the container, not to the ask. The ask
should be as specific as you can make it: a specific goal generates a small
targeted set of new nodes, which is what keeps this cheap and keeps the graph
honest. A vague goal generates a broad shallow sweep, which is allowed and is
simply less useful.

**The one hard constraint is on the subject, not the goal.** `Economics` works.
`Science` does not — its concepts have no prerequisite relationships with each
other, so the "graph" would be a list with no edges, and every rule below that
depends on edges would do nothing. The test: could one survey course plausibly
cover it? Economics yes. Philosophy yes. Machine learning yes. Science no. The
humanities no.

When a typed goal resolves to a subject you already have, it joins it. When it
does not, the app proposes a subject and you can override it in one click.
Nothing is auto-created silently, because the subject is the thing that
accumulates and getting it wrong twice leaves you with two half-graphs.

## What a concept is

A node is **one claim you can be right or wrong about**, not a topic heading.

- Heading: *The Phillips curve.*
- Claim: *Inflation and unemployment trade off in the short run, because wage
  expectations adjust more slowly than prices — and the trade-off disappears
  once expectations catch up.*

Headings are what a table of contents holds. They cannot be probed, they cannot
be wrong, and a graph of them is a syllabus. Claims can be probed, which is the
entire point. Every node carries a name (short, for the graph view) and a claim
(one or two sentences, and the thing a question is written against).

Every node also carries a **basis** — the same discipline the reading side
already runs on. "Standard in any intermediate macro sequence" and "inferred
from the goal, not checked against a syllabus" are different claims about a
node, and the difference is visible.

Every node carries two to four **checks** as well: short statements of what
having the idea actually looks like — what it rules out, how it applies to a
case with the numbers changed, what the standard objection to it is. Every path
that creates a concept writes them, and they are on the approval screen before
the chain is saved, so a bad check can be refused before it is stored. A
question is written against one of the checks rather than against the claim in
general.

## The graph is never finished

It is not generated once. Generation is simply the first growth event. After
that it grows on five triggers:

1. **You name a new goal in the subject.** Generate only the missing chain,
   dedupe against what is already there, attach.
2. **A probe finds a floor you do not have.** You get something wrong in a way
   that points one level down — add the prerequisite under the node you failed
   and probe *that* next.
3. **A probe finds you already know something above.** Mark the intervening
   nodes known-by-inference — a weaker state than tested, recorded as such —
   and skip forward.
4. **A reading introduces a concept the graph does not have.** When you finish
   a reading and write a note, extract the concepts it actually introduced and
   attach them.
5. **You ask for depth.** "Go deeper here" expands one node into its children.

Two rules stop this becoming an undifferentiated blob:

**Nothing is added without an edge.** A node with no prerequisite and no
dependent cannot be written. If the generator cannot say what a concept sits on
top of or what sits on top of it, it does not belong in the graph — that is the
mechanical version of the rigour rule, and it is enforced in the database, not
by a prompt.

**Pruning happens at view time, not write time.** The store keeps everything.
Any view of a goal shows only the nodes on a path from something you already
know to that goal. The graph can grow to hundreds of nodes and the screen stays
a dozen. That is also the answer to "how do I not get shown thirty things I
already know": you are not, because they are not on a path from anything
unsettled.

**Cycles are rejected by the database.** A prerequisite edge that would close a
loop fails the insert. Same instinct as `locator_basis` being `not null` on the
reading side: the property the module promises is a database fact, not a
convention the application is trusted to keep.

## Probing

Ten questions to start, then keep going as long as you want. Each question
targets exactly one concept and is written against that concept's claim.

The rules for writing them, adapted from what works elsewhere:

- **One concept per question.** A question that needs two ideas tells you
  nothing about either when it is missed.
- **Test use, not recall of a name.** The question describes a situation and
  asks what follows. It does not ask what a thing is called. Somebody who can
  define the Phillips curve and cannot say what happens to it when expectations
  adjust does not know the Phillips curve.
- **Wrong options must be things a person who half-knows would actually pick.**
  A distractor that nobody chooses is a wasted option and makes the question
  easier than it looks. The good ones come from the specific ways this idea is
  usually misunderstood.
- **The correct answer carries a one-line reason, written at the same time and
  stored.** It is shown after you answer. If the reason cannot be written
  without appealing back to the question, the question is thrown away and
  rewritten — that check is the cheapest verification available and it catches
  most of the bad items.
- **A specific wrong answer picked twice becomes a named misconception**, stored
  on the node, and it is the most valuable thing the whole system produces. It
  is a distinct state from "does not know": not knowing is a gap, and a
  misconception is something actively steering you wrong that you will not find
  by reading more.

Four states per concept: `unknown`, `shaky`, `known`, `misconception`. Each
carries how it was established — `tested`, `inferred`, or `declared` — because
"you told me you knew this" and "you answered three questions on it" should not
look the same on a screen.

Every state also carries the date it was last actually answered on, in
`tested_at`, written by the answer and by nothing else. Every screen that shows
a state shows that date beside it, so "known" does not read the same whether the
question was yesterday or in March. A concept marked known by inference, or
because you said so, has no date and shows no line rather than one saying never.

One question in five goes back over old ground. Instead of the next claim on the
frontier it is about the settled claim you were asked about longest ago, and
only from claims last answered more than a month ago; when nothing is that old
the turn is skipped and an ordinary question is asked instead. The five-minute
screen counts those four questions across every subject and a session inside one
subject counts its own, both read back from the stored answers rather than held
between questions — there is no session object anywhere in this module.

Nothing decays on a timer. The state and the bar move only when you answer
something: a re-check you get right settles the claim again, and one you get
wrong makes it shaky, which puts it and everything resting on it back on the
frontier at once. A bar that falls while you do nothing is a nag, and the
reading side already refused that once.

Every question records which of the concept's checks it tested. The states do
not read that record — one correct answer still settles a concept, whether or
not its other checks have been asked about — but the progress bar does, and
that is the next section.

## The progress bar

Not a percentage of a fixed list, because there is no fixed list. It measures
how much the system has learned about you, and it moves the way information
actually arrives: fast at first, then slower and slower.

    filled = 1 − 0.85 ^ w

`w` is information weight, not question count. What an answer is worth is
decided by the check the question tested and what earlier answers did with that
same check, not by whether the concept was already settled:

| what happened | weight |
| --- | --- |
| got a check right that no earlier answer had got right | 1.0 |
| missed a check you had not missed before | 1.0 |
| answered about a check an earlier answer already got right | 0.3 |
| missed again a check you have already missed | 0 |
| inconclusive — ambiguous answer, or a question that failed its own check | 0 |

A check counts as covered only once you have got it right, so the answer that
closes a gap earns the full amount even though an earlier answer missed it. A
first miss earns the full amount too, because it is what found the gap; missing
the same check again earns nothing.

A concept that carries no checks has nothing to weigh from, so it keeps the
older rule: 1.0 for settling it when it was unknown, 0.3 for reinforcing one
already settled.

Ten clean questions puts the bar at 80%. Twenty puts it at 96%. Forty puts it
at 99.8%. It never reaches 100%, and that is not a trick — nothing here can
establish that you know a subject, and a bar that hits 100% would be claiming
it did. Display caps at 99%.

Weighting by information rather than by questions answered is what stops the
bar rewarding you for answering ten easy questions about the same node, or ten
about the same part of one.

## What it costs, and the one decision that decides it

**All state lives in Postgres, and every model call is short and independent.**

That is the whole cost story. Systems like this get expensive one way: they
carry the session in a growing conversation, so question forty pays to re-read
questions one through thirty-nine. That is the difference between a session
costing ten dollars and costing twenty cents. Here, a probe call gets the
concept's claim, the last three results on that concept, and nothing else. The
subject's concept list goes in as a cached prefix.

Model per operation, chosen rather than defaulted:

| operation | model | why |
| --- | --- | --- |
| generate a goal's chain | Sonnet | judgment, but about a well-mapped field, not the open web |
| write one probe | Haiku | one claim in, one question out, tightly constrained |
| grade a probe | none | the answer is a stored index; grading is a comparison |
| name a misconception | Haiku | only fires on the same wrong option twice |
| extract concepts from a note | Haiku | extraction, not judgment |
| rebuild a graph you said was wrong | Opus | rare, and you asked for it |

Rough numbers: a new goal in a fresh subject is one Sonnet call, about $0.05. A
new goal inside a subject you already have is about $0.01, because the existing
concept list is a cache read. Ten probes is about $0.02. A first session on a
brand new subject lands under ten cents; every session after that is pennies.

Everything is user-initiated. Nothing runs on a cron. The reading side already
holds that line and there is no reason to break it here.

**Every model call writes to a spend ledger** — module, operation, model, input
tokens, cached input tokens, output tokens, cost. Built first, before anything
that spends, because a cost claim you cannot check is a cost claim you will
find out about on a bill.

## Tables

In `learn`, same rules as the rest of the schema: RLS on everything, composite
foreign keys carrying `user_id` so a link across accounts is impossible rather
than merely unlikely.

| table | holds |
| --- | --- |
| `subjects` | the container. name, one row per subject per user |
| `concepts` | a node: name, claim, basis, its two to four checks, how it got here |
| `concept_edges` | prerequisite → dependent, within one subject, acyclic |
| `concept_mentions` | one claim refers to another: source, target, why. Both directions allowed |
| `goals` | what you typed, the concept it resolved to, and its status |
| `concept_state` | one row per concept: state, how established, when tested, any named misconception |
| `probes` | every question asked: the check it tested, options, correct index, its reason, what you chose, the weight it earned |

`concept_mentions` is the one relation nothing walks. An edge says you cannot
understand this without that first; a mention says this claim brings that one
up, which two claims often do to each other. Nothing that decides what to show
or what to learn next reads it — the pruning rule, the learning order and "what
is ready now" run on `concept_edges` alone — and mixing the two would put back
into the walk the cycles the edge trigger exists to keep out.

`probes` is the evidence trail, and it is kept in full rather than collapsed
into a score. It is what makes "you have been wrong about this three times in
four months" answerable, and it is what any future re-probing schedule reads.

The spend ledger goes in `core`, not `learn` — the job side will want it too,
and a per-module cost table would be three tables with the same columns.

## Screens

| route | what it is |
| --- | --- |
| `/learn/know` | your subjects, each with a line on how much is settled |
| `/learn/s/[id]` | one subject: the graph, its goals, what you know and what is shaky |
| `/learn/s/[id]/probe` | a probe session: one question, the bar, the reason afterwards |
| `/learn/c/[id]` | one concept: the claim, where it stands, what it sits between, what was asked |

Same shell and design system as the other four workspaces. The graph view shows
the pruned graph by default with a toggle for everything, because the pruned one
is the useful one and the full one is the one you want when you suspect
something is missing.

## Where this meets the reading queue

The two halves are worth much more joined than separately, and joining them is
small:

- A concept marked `shaky`, and especially one carrying a misconception, is a
  much better input to `suggestSources` than a subject you typed — it is a
  specific claim you are specifically wrong about. So "find me something to read
  for this" is a button on a concept, and it lands in the existing queue.
- Finishing a reading and writing a note is growth trigger 4. The note you
  already write is the input; nothing new is asked of you.
- A track can name a goal, so the queue's ordering can follow the graph's
  prerequisites rather than the order the list happened to arrive in.

## Build order

Each slice is useless without the one above it, same as everywhere else here.

1. **The spend ledger.** In `core`, with a screen. Before anything that spends,
   so every cost number in this document is checkable a week after it is
   written.
2. **The graph store and the subject screen.** Tables, RLS, the cycle trigger,
   the isolation test, and a read-only view over a graph seeded by hand. No
   model calls at all. Proves the pruning rule and the view before generation
   can hide a bad one.
3. **Generation for a goal.** One Sonnet call, dedupe against the subject,
   attach, show it and wait for approval before anything is taught. The
   approval step is not politeness — it is the cheapest possible check on a
   generated graph, and a wrong graph is worse than no graph.
4. **Probing and the bar.** One question per call, the reason check, the four
   states, misconception naming on the second repeat.
5. **Growth from probing.** Triggers 2 and 3 — the graph starts changing shape
   because of how you answer.
6. **Joined to the queue.** Gap to reading, reading note to concepts.

## Open questions

- **The same concept in two subjects.** Marginal utility is genuinely in
  economics and in decision theory. Scoping dedup to a subject makes the
  matching problem small and the duplication real. Deferred deliberately: the
  cost of a duplicate is low and the cost of a bad cross-subject merge is high.
  Decide it after seeing real duplicates, not before.
- **Multiple choice, or free text?** Multiple choice is free to grade and hard
  to game only if the distractors are good. Free text is a much better probe and
  needs a grading call per answer. Start with multiple choice, measure how often
  a correct answer looks like a guess, and revisit with data.
- **Prior learning.** Degrees, transcripts, syllabi — everything in slice 6 of
  the reading spec — would pre-fill large parts of a graph and skip a lot of
  probing. Explicitly out of scope here, and the graph is the store it will
  eventually land in.

# Learn: what you know

The second half of the learn module. The first half ([LEARN-SPEC.md](LEARN-SPEC.md))
answers *where do I read this*. This answers *what do I actually know, what am I
missing, and what is the one next thing worth learning*.

**Four decisions here are revised by [LEARN-MAP-SPEC.md](LEARN-MAP-SPEC.md)**,
which works out how the map is actually shaped and built: a node is a *position*
rather than only a claim, subjects are labels rather than containers, an
authored orphan is allowed where an extracted one is not, and the per-note
extraction budget is dropped. Each is marked there with its reason. Everything
else below stands.

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
   nodes at the state that answer reached, established by inference rather than
   by testing and recorded as such, and skip forward.
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

Ten questions to start, then keep going as long as you want. Each question is
about exactly one concept, and it is written against one of that concept's
checks, or against the claim itself for a concept carrying none.

### The three rungs

Picking the right answer out of a list does not show that somebody can use an
idea, so one right multiple-choice answer does not settle a concept. Every
question is asked at one of three rungs, and which rung a concept gets next is
read off the answers already stored about it.

**Recognise.** Three or four options, one of them right. Graded by comparing
the index picked against the index stored, so it costs nothing to grade.

**Apply.** A situation the claim does not already describe, ending in a
question about what follows, answered in a sentence or two of your own words.
One model call writes the case and the answer it expects, and a second grades
what was typed against that answer. An idea gets one case rather than one per
check, aimed at whichever check the multiple-choice answers left weakest — the
one missed most often, and the first-written of them when nothing separates
them.

**Defend.** State the position and answer the strongest objection to it. This
is where the ladder ends, and it is not built: `learn.probe_rung` carries
`defend` and the state enum carries `sharp`, so the rung has somewhere to land
when it is written, but nothing produces a defence question today and nothing
writes `sharp`.

A concept is asked multiple-choice questions until every one of its checks has
been got right at that rung, and applied cases from then on. Getting one check
right does not move it up: recognising an idea in one place and not another is
what the rung is there to find. A concept carrying no checks moves up on one
right answer, and its case is written against the claim itself. Once an applied
case has been answered right the picker stays on `apply`, because the rung above
it does not exist yet — a concept that comes round again gets another case
rather than dropping back to questions it has already answered.

Which column says whether a question was answered depends on the rung: the
index picked at the first, the grader's verdict at the other two. A question
put and abandoned is not put again and settles nothing.

### Writing a multiple-choice question

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

### Writing an applied case

- **The situation is invented, not lifted from the claim.** A case built out of
  the words of the claim is the claim asked back, and it can be answered from
  memory without using the idea. Two or three sentences of particular
  circumstances — a firm, a measurement, a year — and then what follows.
- **Answerable from memory in a sentence or two.** No arithmetic, no
  derivations, nothing that needs a source open. The work is seeing which way
  the idea points in a situation nobody has pointed it at before.
- **The answer expected is written with the case and stored**, the same rule the
  one-line reason follows on a multiple-choice question. It is shown only after
  you answer, so it stays the answer the case was built around rather than a
  reply to whatever was typed. A case that gives its answer away, and one that
  only asks the claim back, are refused before anything is stored.
- **Right or wrong, with nothing between.** The right direction with the wrong
  mechanism is wrong, and so is the claim restated without being applied to the
  situation. Half credit would call a concept known off a near miss, and a
  concept marked known is one the views stop offering.
- **The grader writes its sentence before its verdict**, and both are stored on
  the question beside what was typed. A concept page read a month later has the
  case, the answer expected, the answer given, and why it was marked as it was.
- **A case about something you are already sure of can be waved through.** A
  button beside the answer box marks the concept `known`, established
  `declared`, and no model is called because nothing is typed and nothing is
  graded. The state reads "you said so" like any other declaration, and the
  case stays on the concept's history as a question that was put and not
  answered.

### The states

Six states per concept: `unknown`, `shaky`, `recognised`, `known`, `sharp`,
`misconception`. Three of them are the ladder, and each says what a right answer
at one rung showed: `recognised` for picking the idea out of a list, `known` for
using it in a case you have not seen, `sharp` for holding it against the
strongest objection. Nothing writes `sharp` until the defence rung is built.
`shaky` and `misconception` sit outside the ladder — they are evidence against,
not a weaker rung of evidence for — and a wrong answer at any rung writes
`shaky`.

Settled means `known` or `sharp`. A recognised concept is not settled, so it
keeps its place on the subject screen, in what to learn next and in the order
questions are asked in, because its applied case has not been answered yet.

Each state carries how it was established — `tested`, `inferred`, or `declared`
— because "you told me you knew this" and "you answered three questions on it"
should not look the same on a screen. A right answer also marks what the concept
rests on at the state that answer reached, established `inferred`, and never
over a concept somebody has answered about.

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
something: a re-check you get right leaves the claim at whatever that rung can
show, and one you get wrong makes it shaky, which puts it and everything resting
on it back on the frontier at once. A bar that falls while you do nothing is a
nag, and the reading side already refused that once.

Every question records which of the concept's checks it tested and which rung it
was asked at. The state does not read that record — it is written from the rung
and the verdict alone — but the rung picker above reads both, and so does the
progress bar, which is the next section.

## The progress bar

Not a percentage of a fixed list, because there is no fixed list. It measures
how much the system has learned about you, and it moves the way information
actually arrives: fast at first, then slower and slower.

    filled = 1 − 0.85 ^ w

`w` is information weight, not question count. What an answer is worth is
decided by the check the question tested, the rung it was asked at, and what
earlier answers at that rung did with that same check, not by whether the
concept was already settled:

| what happened | weight |
| --- | --- |
| got a check right at this rung that no earlier answer there had got right | 1.0 |
| missed a check at this rung you had not missed there before | 1.0 |
| answered about a check an earlier answer at this rung already got right | 0.3 |
| missed again a check you have already missed at this rung | 0 |
| inconclusive — ambiguous answer, or a question that failed its own check | 0 |

A check counts as covered only once you have got it right, so the answer that
closes a gap earns the full amount even though an earlier answer missed it. A
first miss earns the full amount too, because it is what found the gap; missing
the same check again earns nothing.

A check is looked up by the rung as well as by its text. The applied case about
a check you already got right out of a list is the first time anything has shown
you using that idea, so it is worth the full amount; looked up by the text alone
it read as a repeat and earned the fraction.

Answering the same question twice earns nothing the second time, at any rung.

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

## What to do next

`/learn/next` answers "what is the one next thing worth learning" once, across
every subject, instead of a subject and a goal at a time. It is read straight
off the graphs and the reading queue — one pass over the subjects, no model
call — so it is a page you can open out of idleness.

Three kinds of row can appear on it:

- **A claim you are ready for.** Nothing is missing underneath it, which is the
  same set the subject screen offers and the same ordering: nearest to a goal
  you named first.
- **A claim worth asking about again.** Settled, and last answered more than a
  month ago — the same cutoff the one-question-in-five re-check uses inside a
  probe session. Longest unasked first.
- **A reading you queued about a claim and never opened.** Only the ones that
  name the concept they were queued to close, because only those can say what
  they are about. Longest in the queue first.

Each kind's own order is right about its own kind and says nothing about the
other two, so the three are not scored against each other: two steps from a
goal and seven months unchecked are not comparable numbers. The list takes one
row from each kind in turn and skips a kind that has run out, which puts one of
each at the top when all three exist and collapses to a single kind's order
when only one does. Eight rows, the same cut the tab badge counts, so the
number and the page cannot disagree.

**Every row says in one line why it is there.** Three kinds mixed into one list
are unreadable without it.

Before the turns are taken, what you have already done moves each kind's order.
`next_outcomes` holds one row per thing you did with something this page
offered, and there are exactly three: a question answered about a claim, a
reading marked read, and a row pushed aside with Not now. A row you pushed
aside goes to the back of its kind for three weeks and says so on the row when
it comes back; a subject you have been finishing things in comes before one you
have not touched. The record is read sixty days back, which is long enough to
hold a Not now through its three weeks and still show where it came from
afterwards.

**Nothing records that a row was shown, that it was clicked, or how long
anybody looked at the page.** That is a rule about this page and not an
omission: the order is computed from what is in the record, so a signal that
cannot be written cannot be weighed. The three outcomes are all things you did
on purpose, and they are written from the places they already happen — the
probe answer, the reading's status, the Not now button — never from a page
render. Opening this page and closing it leaves nothing behind.

When none of the five growth triggers has fired for a while and all three lists
are empty, the page does not show an empty box and does not generate anything
on its own. It offers the one thing that would give it something: name a goal,
which is trigger 1, costs a call only when you press it, and goes through the
same approval screen as every other way into the graph. An account with
subjects to extend and an account with no subjects at all reach that state for
different reasons and are told so differently.

## What it costs, and the one decision that decides it

**All state lives in Postgres, and every model call is short and independent.**

That is the whole cost story. Systems like this get expensive one way: they
carry the session in a growing conversation, so question forty pays to re-read
questions one through thirty-nine. That is the difference between a session
costing ten dollars and costing twenty cents. Here, a multiple-choice call gets
the concept's claim, the last three results on that concept, and nothing else.
An applied case call gets the claim, the one check the case is aimed at, and the
situations already used for that claim; the grading call gets the case, the
answer expected and what was typed. None of them carries the session. The
subject's concept list goes in as a cached prefix.

Model per operation, chosen rather than defaulted:

| operation | model | why |
| --- | --- | --- |
| generate a goal's chain | Sonnet | judgment, but about a well-mapped field, not the open web |
| write one multiple-choice question | Haiku | one claim in, one question out, tightly constrained |
| grade a multiple-choice answer | none | the answer is a stored index; grading is a comparison |
| write one applied case | Haiku | one claim and one check in, one situation and the answer it expects out |
| grade an applied answer | Haiku | there is no index to compare; a typed answer has to be read |
| name a misconception | Haiku | only fires on the same wrong option twice |
| extract concepts from a note | Haiku | extraction, not judgment |
| rebuild a graph you said was wrong | Opus | rare, and you asked for it |

Rough numbers: a new goal in a fresh subject is one Sonnet call, about $0.05. A
new goal inside a subject you already have is about $0.01, because the existing
concept list is a cache read. Ten multiple-choice questions is about $0.02.

An applied case is two Haiku calls where a multiple-choice question is one, so
one costs about $0.005 against about $0.002 — near enough twice. An idea gets
one case however many checks it carries, so taking one idea from nothing to
`known` is its two to four questions plus one case, around a cent. A first
session on a brand new subject lands under ten cents; every session after that
is pennies.

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
| `concept_state` | one row per concept: which of the six states it is in, how established, when tested, any named misconception |
| `probes` | every question asked, at any rung: the rung, the check it tested, the weight it earned, and the columns that rung uses |
| `next_outcomes` | what came of a row Learn next offered: a question answered, a reading read, or a Not now |

`concept_mentions` is the one relation nothing walks. An edge says you cannot
understand this without that first; a mention says this claim brings that one
up, which two claims often do to each other. Nothing that decides what to show
or what to learn next reads it — the pruning rule, the learning order and "what
is ready now" run on `concept_edges` alone — and mixing the two would put back
into the walk the cycles the edge trigger exists to keep out.

`probes` holds all three rungs in one table, because a row is already "one
question about one concept, and what came back" and the rung changes only which
columns carry the question and the answer. A multiple-choice row carries
`options`, `correct_index`, `reason` and `chosen_index`; an applied row carries
the case in `question`, the answer it expects in `expected`, and then `response`,
`response_correct` and `grade_reason`. Those columns are nullable with check
constraints refusing a row that is half of each: the three multiple-choice ones
are required at `recognise` and refused at every other rung, and `expected` the
other way round. Splitting the written rungs into a second table would have put
a union in front of every read of a concept's history.

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
| `/learn/s/[id]/probe` | a probe session: one question at whichever rung is next, the bar, and afterwards the reason or the answer that was expected |
| `/learn/c/[id]` | one concept: the claim, where it stands, what it sits between, what was asked |
| `/learn/next` | what to do next across every subject: a claim to start, one worth checking again, a reading you left |

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
4. **Probing and the bar.** One question per call, the reason check,
   misconception naming on the second repeat.
5. **Growth from probing.** Triggers 2 and 3 — the graph starts changing shape
   because of how you answer.
6. **Joined to the queue.** Gap to reading, reading note to concepts.
7. **The ladder.** The rung on every question, the applied case and its grader,
   the states the two built rungs write, and the columns a typed answer needs.
   The defence rung is left as a value in two enums with nothing writing it.

## Open questions

- **The same concept in two subjects.** Marginal utility is genuinely in
  economics and in decision theory. Scoping dedup to a subject makes the
  matching problem small and the duplication real. Deferred deliberately: the
  cost of a duplicate is low and the cost of a bad cross-subject merge is high.
  Decide it after seeing real duplicates, not before.
- **What a defence question is.** The top rung is described above and not
  built. What the objection is written against, whether one objection held is
  enough to write `sharp`, and how a defence is graded when the position itself
  is the thing being argued, are all undecided. Multiple choice against free
  text is no longer one of the open questions: the rungs are both, at different
  prices, and the defence rung will be free text as well.
- **Prior learning.** Degrees, transcripts, syllabi — everything in slice 6 of
  the reading spec — would pre-fill large parts of a graph and skip a lot of
  probing. Explicitly out of scope here, and the graph is the store it will
  eventually land in.

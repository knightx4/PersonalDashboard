# The plan

`/dev/plan` is the source of truth for what gets built next. It holds the
features that were decided on, the steps that get you to each, and the steps
beneath those — to any depth — with each step's status, priority, size, who
is on it, what it waits on, and what "done" means for it. A person works it
on the page; a Claude session works it through `scripts/plan.ts` and
`.claude/skills/plan`; both read and write the same rows, so neither can be
out of date with the other.

It is not an issue tracker. There is one account, one repository and two
builders, and everything Linear or Jira has that exists to coordinate more
people than that is left out. What is kept is the part that changes what gets
picked up next.

## Where it came from

The plan began as `docs/BUILD-ORDER.md` and the per-module specs, and was
seeded from them once (migration 0051, the *Import the build order* button).
The seed itself, `lib/plan/seed.ts`, is still read: opening the page brings in
any step in it that has never been offered to this account, recorded in
`plan_seed_imports` (migration 0055). Offered once is the whole rule — delete a
step you decided against and it stays deleted, and nothing already in the plan
is touched. That is only for steps that come from the repository; steps written
here or through `scripts/plan.ts` never go near it.
The documents remain the record of *why* each step is where it is. They are
not read at runtime and are not kept in sync: the app is the working copy,
and the two are expected to drift. Migration 0052 made the flat list a tree
and gave a step the rest of what is described here. Migration 0054 added
`kind`, `fog` and `resolution`, borrowed from the wayfinder planning skill —
see *Decisions, setup and fog*. Migration 0084 added the third kind.

## The model

Three tables in `public`, all under row level security, and `dev_comments`
beside them.

### `plan_items`

| Column | Meaning |
|---|---|
| `number` | The short, stable handle — "#12" — per account. Assigned by a counter on the profile and **never reused**, so a number in a commit message stays meaningful after the step is deleted. |
| `module` | The workspace the step belongs to, or null for the app as a whole. A sub-step always has its parent's module. |
| `parent_id` | The step this is part of, or null at the top of a module's plan. Cascades on delete: removing a feature removes its steps. |
| `title`, `detail` | What it is, and what it involves. |
| `acceptance` | *Done when.* Written before the work, it is what the work is checked against. A step without one is closed on somebody's opinion. |
| `status` | `proposed`, `not_started`, `in_progress`, `blocked`, `done`, `dropped`. A proposed step was written by a session from an idea and is waiting on the person; see *Proposals* below. |
| `kind` | `build`, `decision` or `setup`. A build step closes on a commit; a decision closes on an answer; a setup step is a job of the person's outside the repo and closes when they say they have done it, with no commit. See *Decisions, setup and fog* below. |
| `fog` | The *not yet specified* note: one paragraph admitting what cannot yet be seen well enough to write steps for. Allowed on any step, meaningful mostly on a feature. |
| `dismissed_at`, `fog_dismissed_at` | Put aside as not right now — the row, and the patch of fog on it, separately. Not a status: nothing has been settled, it is only out of sight. See *Not right now* below. |
| `resolution` | The answer a decision closed with, in the person's words. Null on a build step and on a decision nobody has settled. |
| `comment` | Your own note on it: why it stalled, what changed. The CLI appends a dated line when it closes or blocks a step. |
| `priority` | 1 next, 2 normal, 3 someday — the same three the notes queue uses. |
| `size` | `s`, `m` or `l`. Coarse on purpose: "one sitting or not", not hours. |
| `assignee` | `me`, `claude`, or nothing at all. `me` is a step you kept for yourself; every other approved step is one a routine may pick up on its own, which is what approving it did. `claude` reads the same as an empty column. Every hand-over used to write it; the feature Send stopped in #672 and the Send on one step in #714, so nothing writes this column when a step is claimed. |
| `commit_sha` | The commit that shipped it. |
| `position` | Order among siblings. Sparse; re-dealt in tens when a step is moved. |
| `started_at`, `completed_at` | Kept by a trigger from the status. Done and dropped both count as finished; a reopened step loses its completion time. |

Two triggers keep it a tree. A parent has to be the same account's own step
— "another account's step" and "no such step" are the same refusal, because
the lookup runs under the caller's policies — and a step cannot be moved
under one of its own descendants.

### `dev_comments`

A comment is something you want attached to a row rather than to a session
transcript: a question about a step, what you think of an idea before it is
shaped, a note on a raise that is not the answer to it. One table holds all
three, with `idea_id`, `plan_item_id` and `raised_item_id` nullable and
exactly one of them set (migration 0062, grown out of the thread under a
raise). `author` is `me` or `claude`, because a session writes with your
account and the column is what tells the two halves of a thread apart.

Not the same thing as `comment` on the step, which is the note the CLI
appends a dated line to when it closes or blocks something.

#### Asking rather than noting

A comment with `@dash` in it is a question and gets a reply in the same thread;
one without is a note to yourself and starts nothing. The tag has to stand on
its own — `@dashboard` and `me@dash.io` are not asking anybody anything.

Two paths produce the reply, which is what #339 settled. A direct model call
runs first with the row written out and the thread so far, and nothing else: no
repository, no database. Most questions asked on a row are about what is written
on it, and that call answers them in seconds. When the question needs to know
what the code currently does, that call says so instead of guessing, and the
plan routine is started with the row, the question and where the answer goes.
The thread says which happened, so a reply that is still minutes away does not
look like one that failed.

Asking never decides anything. A question on a decision leaves it open and
answerable, a question on an idea leaves it unshaped, and a question on a step
changes no column on it — the reply is a comment like any other. A reply that
cannot be produced at all says so in the thread, and the question stays where it
was written.

### `plan_runs`

Every routine a dev button starts, and what Anthropic answered. One row per
press: the step it is about where there is one, which button fired it (`job` —
`step`, `feature`, `queue`, `reshape`, `shape`, `notes`, `review`, `comment`),
the routine the request went to, and the response body kept whole in
`response`. `external_id` is whatever in that body looks like a name for the
run; it is null until it is known what the endpoint returns, which is why the
body is stored beside it.

A press that never started is a row too — `status = 'failed'` with the reason
in `error` — because "the token was wrong" and "nobody pressed it" are
different facts and looked identical before this table existed.

Written by `lib/plan/runs.ts`, which is the only way a routine is fired: the
fire and the record are one call, so a new button cannot start a run the app
does not know about. Recording a run never fails the press — by then the
routine is already going, and saying it is not would be the worse lie.

The row also keeps what GitHub last said about the run, so every surface reads
one answer instead of each asking or falling back to the clock:
`github_checked_at` when it was last asked, `last_push_at`, `last_push_sha` and
`last_push_subject` for the newest push it had made by then, and `github_error`
for a refusal — a missing or rejected key, or a repository GitHub will not
show. `github_checked_at` is the test of whether there is a reading at all: null
means nobody has asked, and set with `last_push_at` null means somebody asked
and the run had pushed nothing. `github_error` is separate from `error`, which
is Anthropic refusing the fire and is tied to `status = 'failed'`; a rejected
GitHub key says nothing about whether the run started. `storedReading` in
`lib/plan/run-end.ts` turns the five columns into the shape the app reads, and
`readingFor` and `readingColumns` beside it turn a reading back into the
columns, so the write and the read are worked out in one place.

`app/api/plan/runs` is the only thing that asks GitHub about a run.
`refreshRunReadings` in `lib/plan/runs.ts` does the work: the reader from
`readRunLiveness` gets the claimed steps, the runs behind them and one activity
listing; the listing says which branch moved and to what sha and nothing about
what the commit said, so `commitSubjects` looks the message up separately and
is allowed to come back with nothing. Then the runs are written back and the
same listing goes to `endQuietRuns`, which is what stops a run that pushed four
minutes ago being written off for being five hours old. A refusal is written to
`github_error` and carries no push beside it: a reading is what GitHub said
this time, not a push from the last time somebody got through.

### `plan_overnight_runs`

One row per account, holding what the overnight runner is doing. You press one
button before bed and a cron tick fires one feature at a time — the existing
feature send — waiting for each to finish before starting the next. None of
that can live in the page, because the tick runs with nobody's tab open, so the
intention is a row: `running`, `paused`, `features_budget` and `features_left`,
`stop_by`, `started_at`, `last_fired_at`, and `ended_at` with `ended_reason`.

The budget counts down at the fire rather than at the finish — a feature that
fell over cost the night the same as one that worked. Pausing is not stopping:
the budget and the stop time survive it, so resuming carries on the same night
rather than starting a second one.

`ended_reason` is a written sentence, not a code, because the morning report
reads it back to a person: *It fired every one of the 6 features you allowed.*
The set of reasons is not closed — the budget and the clock are decided from
the row, you stopped it is decided by the page, and nothing being ready to
build is decided by the tick — so no enum could name them all for long. A
constraint pairs it with `ended_at`: a night that ended carries the reason it
ended, and a reason without an end is a sentence about nothing.

Written only by `lib/plan/overnight.ts`, which also holds `overnightVerdict` —
the pure reading of the row that says whether another feature may be fired, and
what to end the night with when it may not.

The chooser is `chooseOvernightFeature` in `lib/plan/overnight-choice.ts`: the
row's verdict and the plan tree composed into one answer, either the feature to
fire or the sentence to stop on. It picks what a person would — the first row
of `workOrder(sections, { assignee: 'claude' })`, and the top-level feature
above it — so a feature it names always has a ready step beneath it, and
nothing about blocked, waiting or unapproved work is restated here. Still being
built around it: the tick route, the schedule, the page control and the report.

### `plan_dependencies`

`item_id` cannot start until `depends_on_id` is done. One direction; the
other reading ("this unblocks that") is the same row read backwards. A
trigger refuses a loop, however long the way round, and refuses either end
belonging to another account. Deleting either step deletes the row.

Waiting on another step is a relation rather than a status because it
clears itself: the moment the other step is done, this one is ready, and
nobody has to remember to come back and unblock it. `blocked` is for waiting
on the person — an answer, a decision. An API key or an account is a setup
step and therefore a dependency like any other; see *Setup steps*.

Rows given both — blocked, and with dependencies naming what they wait for —
record which they mean in `plan_items.block_kind`, settled by #525 and added
by migration 0081. `steps` is a block on the rows it names, and it clears
itself when they all close. `outside` is a block on something only the person
can supply, and it stays blocked however much else closes. The database
refuses a row that says `blocked` without one, every path that blocks a step
writes it (the status control, the edit form, `plan.ts block --on-steps`), and
it is cleared whenever the step stops being blocked, like `block_ask`. A block
written without saying which is taken as `outside`: a block that outlives its
reason is a row somebody looks at, and one that clears itself too early is an
afternoon a session loses.

`isStaleBlock` in `lib/plan/tree.ts` is the one place that reads it, and every
surface reads through that: the health on the row, the Ready and Waiting views,
the counts on the summary strip, a feature's roll-up, "On you", and the Send
button's refusal. A `steps` block whose named steps have all closed reports the
step it now is -- ready, or not started -- and is handed over like any other. An
`outside` block reports `blocked` on all of them however much else closes, and
Send refuses it until the person moves it.

## Proposals: from an idea to the plan

An idea on `/dev/ideas` is a sentence. A plan step needs a parent, steps
beneath it, a "done when" and a size, and writing that well takes knowing
the code. So the shaping is Claude's job and the approving is the person's.

1. **Shape into a plan**, a button on each idea, fires the feature routine
   with the idea as the brief and the shaping procedure from
   `.claude/skills/plan` as the job.
2. The session reads the idea and the code and writes a feature with its
   steps into the plan, every one in the **`proposed`** status, and links
   the idea to the feature (`ideas.plan_item_id`). It builds nothing and
   approves nothing. Open questions go in the feature's detail.
3. The person reviews on `/dev/plan`. The proposed view lists what is
   waiting. Three cheap moves are the whole review: drop a step, reorder or
   reprioritise, and **Approve** — the first choice in a proposal's health
   menu, which moves the step and every proposed step beneath it to not
   started in one click. Handing a step to Claude is the fourth move, and
   the one that makes the routine pick it up.
4. From there the building loop applies. The idea's button has become the
   link "in the plan as #n".

A proposed step is never ready, is left out of every progress count, and
is never picked up by `next`. A step beneath a proposed feature is not
ready either, whatever its own status says. Nothing in the skill or the CLI
moves a step out of `proposed` except the person's approve, on the page or
with `scripts/plan.ts approve`.

### Suggestions

The other direction. Once fog stopped being the place to park a follow-on,
those follow-ons needed somewhere to go, and `/dev/ideas` is it: a session
writes one with `scripts/plan.ts idea`, which stamps `source = 'claude'` and
`from_plan_item_id` with the step it came from.

The page keeps the two apart. Your own ideas are the list, grouped by
workspace; suggestions are one section beneath them, each saying which feature
it came out of. A night of follow-ons therefore cannot push the two thoughts
you had off the top of the page, and a suggestion is otherwise an idea like
any other — Shape into a plan works on it the same way.

**Dismissing** is the answer to a suggestion you do not want, and it is not
deleting (#340). `dismissed_at` puts the row in the Dismissed fold at the
bottom of the page, out of every count above it and out of `plan.ts ideas`,
which is what stops the next session offering it again. Bring back returns it
to the list. Delete is still there for a row that should not exist at all.

## Decisions, setup and fog

### When a re-shape starts

Answering the **last** open question under a feature starts one. Not every
answer: three questions settled in one sitting used to mean either three runs
racing each other, or a button nobody pressed. Waiting for the last one gives
one run, started when the feature has every answer it was waiting for. Answer
a fourth later and another starts, which is right, because there is new
information the feature has not been read against.

The **Re-shape** button still exists for a feature with no open questions, or
one whose code has moved on since it was written.

A re-shape that will not start costs nothing. The answer is recorded by its
own action first, so a routine that is unreachable loses an answer only from
the run, never from the plan.

### Fog and finishing

`done` refuses a step that still carries fog, on the page and in the CLI.
Fog says part of the step was never specified; a finished step carrying that
admission is work nobody will look at again. Write the steps the patch covers,
or clear it, then close. `blocked` and `dropped` are unaffected: neither
claims the step is complete. Nor is a patch that has been dismissed — see
*Not right now* below, which is the other way out.

The plan page counts fog in the strip at the top and has a **Not specified**
view. Closed steps are in it, because a shipped feature still carrying fog is
the case worth seeing; dismissed patches are not, which is what dismissing one
did.

Two things a proposal could not say until migration 0054, both borrowed from
the wayfinder planning skill. They exist because of what a shaping session
does when it hits the edge of what it knows: it picks an answer and writes
steps as though the question were settled, or it invents a plausible second
half. Both read, afterwards, exactly like a plan somebody made.

**A decision** is a step whose resolution is an answer rather than a commit.
The session that shapes the feature writes the question, the two or three
real options, what each costs and its recommendation; the person settles it
in one box on `/dev/plan`, or with `scripts/plan.ts answer <n> --note "…"`.
It closes as `done` with the answer in `resolution` and **no commit** — a
question is not work, and a commit against one would be a lie the plan told
about itself.

It is a *kind* rather than a status because it moves through exactly the
states a build step moves through — it can be not started, blocked, dropped —
and differs only in what closing it means. As a status it would have to be
crossed with all five of those to say where the question stood.

A decision counts toward its module's progress like any other step: deciding
is real work, and a feature held up on an unanswered question should not read
as being further along than it is.

**Never answered by a session.** `workOrder` withholds a decision from
`--claude` however it is assigned, `scripts/plan.ts start` refuses one and
says where it is answered instead, `add` withholds `--claude` from one, and
the skill says it twice. The guarantee is worth the four locks: a routine
that can answer its own questions has no questions, only guesses with a paper
trail. The cost is real and accepted — a decision nobody answers stalls
everything that depends on it until the person looks at the page.

**Fog** is the other half. Where a decision is a question sharp enough to
phrase, fog is the admission that a question cannot even be phrased yet: one
paragraph on the feature saying what is not known and what would have to be
found out. The test between them is not whether the question can be
*answered* — it is whether it can be *asked*.

**What may be written as fog** is a second test, and it comes first: if this
is never resolved, is the feature still finished? Yes means it is a follow-on
rather than a gap, and it goes on the ideas page, where it can be shaped into
its own feature later. Fog is what cannot be decided until part of *this*
feature exists. Nine of the fourteen patches on the plan when the test was
written failed it — whether ten interview questions should be asked again
months later, whether the five-minute unit should exist for reading too — and
none of them stopped their own feature being finished. They sat where nothing
reads them again: the feature ships, the patch stays, and the thought is lost
more thoroughly than if it had been dropped. `FOG_RULE` in
`lib/plan/brief.ts` carries the test into both turns that write fog, the
shaping one and the re-shaping one, and `.claude/skills/plan/reference/shaping.md` says it
at length.

**One patch per feature**, because it is one column: a second `fog --note`
replaces the first rather than joining it, and the CLI prints what it replaced
so that losing one is never silent.

Fog is a column rather than a table because it has no life beyond its step:
it graduates into sub-steps and is cleared once they exist. Two things do
that graduating, and until they were built the sentence you just read
described a person doing it by hand: **Re-shape** (below), and a build
session that learns enough while working a step beneath the feature to
specify what the fog admitted it could not. Both write proposed steps and
clear the patch; neither approves anything. It shows in the tree under the step it belongs to
rather than behind the fold, because a plan's own admission that part of it
is missing is no use if you have to open a step to find it. Empty fog
renders nothing.

**Carried forward.** Every answered decision beneath a feature appears in the
brief of every step under it, as *Decided so far*, one line with its answer;
the feature's own done-when appears as *Destination*. Generated from the rows
rather than maintained, so it cannot fall out of date. This is what the
feature is for: a session three nights later builds against what was decided
without being told again, and never asks the same question twice.

**Out of scope** was considered as a sixth status and left out. It is
`drop <n> --note "out of scope: …"`, which reads the same and costs no
column.

### Setup steps

The third kind, added by migration 0084. A setup step is something only the
person can supply — an API key, an account, a value in somebody else's
dashboard — held as a row of theirs on the plan rather than as a sentence in
the ask of the step that ran into it. It closes when they say they have done
it, on `/dev/plan` or in the Dash tab's *Waiting on you*, and carries no
commit.

What it replaces: a session marked the step it was on `blocked`, wrote the
request for the key into that row's ask, and the request then lived inside work
the person was never going to open. Setting the key afterwards moved nothing,
because a block on something outside the plan waits for somebody to clear it by
hand.

`scripts/plan.ts needs "<what to set>" --for <n>` writes both halves: the row,
and the `plan_dependencies` edge from the stopped step to it. #599 settled
where the row goes — under the parent of the step that is stopped, so it sits
beside the work it is holding up, and two features needing the same key get a
row each rather than sharing one somewhere else in the tree. A step that was
`blocked` goes back to `not_started` with its ask cleared, since the edge now
says what it waits for and a step saying it twice would need clearing twice.
Closing the setup step frees the work on its own, because `isReady` already
frees a step once everything it waits on is done. The title is the one-line
summary and the detail is the instructions; the plan row and the Dash tab draw
them in those two roles.

No routine can pick one up. `healthOf` reads an open setup step as a health of
its own, `isWaitingOnThePerson` covers it along with a live block and an open
decision, and `workOrder` filters those out of `--claude`. `needs` refuses a
step that is closed and refuses a setup step waiting on a setup step, which
would say a job of theirs is stopping another job of theirs. The rules with no
database in them are `lib/plan/needs.ts`, tested in `lib/plan/needs.test.ts`.

**What stays a block.** Something the person has to decide or supply that is
not an errand with a done state. The line between them is whether the
instructions can be written: a setup step is a job that can be finished, a
block is a question waiting on an answer.

## Not right now

The third way out of a question, and the only one that says nothing about the
question. Answering it writes something every session under that feature builds
against, so an answer you do not mean is the most expensive thing on the page.
Withdrawing it — `dropped` — says the question stopped mattering. Dismissing it
says neither: it is still open, still unanswered, and out of the way.

#340 chose hidden over gone. Dismissing takes the row off the plan page, out of
every count, out of `next` and `list` in the CLI, out of every brief, and out of
the turn a re-shape is fired with. The **Dismissed** view lists what was put
aside and brings it back in one press. Nothing surfaces on its own, and nothing
is deleted.

Three things can be dismissed, and each has its own column because each is a
different thing to stop asking about:

- **A question.** `plan_items.dismissed_at`. Only an open decision: one that is
  answered has an answer and one that is withdrawn has a reason, and hiding
  either would hide the record rather than the ask. It stops counting toward
  its feature's progress and stops holding its feature open, so a feature whose
  last open row is a dismissed question can still be closed.
- **A patch of fog.** `plan_items.fog_dismissed_at`, separate from the row,
  because a feature whose fog you have put aside is otherwise a live feature
  with live steps. It leaves the *Not specified* view and the count beside it,
  and it no longer makes `done` refuse the step — the refusal is a way of
  raising the gap, and dismissing it is saying not now to exactly that.
  Rewriting the patch clears the dismissal: the new sentence is not one
  anybody has put aside.
- **A suggestion.** `ideas.dismissed_at`, which shipped with the ideas page
  above and works on any idea. What it adds here is the other half: a
  suggestion you turned down is named in the re-shape of the feature it came
  out of, so the session that wrote it does not write it again.

**A session never dismisses and never un-dismisses**, the same rule as never
answering its own decision. What it does read is a list: a re-shape turn ends
with *Already dismissed*, naming the questions, the fog and the suggestions put
aside under that feature, and the instruction not to write any of them back —
not as a proposal, not as the same question in different words, not as fog, not
as an idea. Without that list the next re-shape reads the same code, reaches
the same thought and writes it again, which is the loop dismissal exists to
end. `.claude/skills/plan/reference/dismissed.md` says the same thing at length.

## The routines

Two of them, because there are two queues. **Morning notes review** runs on a
schedule and works `feedback_items`; **Plan step builder** has no schedule at
all and works `plan_items`, fired only by a button here or on the ideas page.
They were one routine once, and one is what the buttons had to share.

That sharing had to end for a reason worth writing down: the bugs page's
*Run Feature Routine* sends **no text of its own**, leaning entirely on the
routine's standing prompt. So a button pointed at the wrong routine does not
fail — it quietly works the other queue. Hence a variable per queue, and a
token per queue beside it, because a routine token is scoped to the routine
rather than to the account and the other one's answers `401 Token is not
authorized for this routine`:

| | id | token |
|---|---|---|
| notes | `CLAUDE_NOTES_ROUTINE_ID` | `CLAUDE_NOTES_ROUTINE_TOKEN` |
| plan | `CLAUDE_PLAN_ROUTINE_ID` | `CLAUDE_PLAN_ROUTINE_TOKEN` |

The ids fall back to `CLAUDE_FEATURE_ROUTINE_ID` and then to a built-in
default; the tokens fall back to `CLAUDE_API_KEY`. `lib/feedback/routine.ts`
hands out an id and a token together as one pair, so an id cannot be repointed
without its token following.

The plan routine's standing prompt is the frame; the turn a button appends
says what this firing is for, and wins:

- ***Send to Claude*** on a step — build that one step, then stop.
- ***Send all n beneath*** on a feature — one session works every open step
  under it in plan order, each verified, committed and closed before the next
  is claimed. It stops at the first step that needs a decision, blocking it
  with the question rather than skipping to a later one. Push and merge happen
  once, at the end. The press writes no row: it starts the session and nothing
  else, because approving is what the runner reads now (#672).
- ***Shape into a plan*** on an idea — write the proposal and nothing else.

The batch button is the one to think twice about. There is no review point
between its steps, so a step that gets something wrong early has the rest
built on top of it before anybody looks. Send a migration on its own; batch
the rest once you have seen what it did.

### Claims, and giving them back

`in_progress` means one thing: somebody has this step in hand right now. A
session writes it when it claims a step and clears it when it closes one, and
a session that dies does neither — so the row went on saying underway for the
rest of the day, which is note 60a0ad01 and the reason #494 exists.

Two halves. `lib/plan/liveness.ts` reads the claim against the run behind it,
so the page stops drawing a dead claim as live and the send guard stops
refusing work under a feature nothing is touching. `inngest/dev/claims.ts` is
the other half: a stage of the daily cron that writes those rows back to
`not_started` with a dated line in `comment` saying the claim expired. Without
it the reading is only on the page, and the CLI, the brief and the next session
all still take the status at its word.

A claim is taken back for one reason, in `lib/plan/claims.ts`: nothing has
touched it for two hours. There was a second until #714 — a claim with no
assignee read as one nothing was working — and it is what made the Send button
and `plan.ts start` write who held a step they marked underway. Both writes are
gone, and the run behind the claim is what the sweep reads instead.

Two hours is a threshold and not evidence, and a long batch is called stale
while it is still going. So the claim is read off the run behind it instead.

**What a claim reads as.** `lib/plan/liveness.ts` has `claimLiveness(step,
run, now)`, and it answers one of four things about a step marked
`in_progress`, or `null` when the row is not claimed at all:

| | |
|---|---|
| `claimed` | The row says a session has it and nothing says what that session is doing: no run recorded, or one nobody has asked GitHub about, and the clock has not run out either. |
| `working` | Its run has pushed something within the last twenty minutes. |
| `quiet` | Nothing pushed for twenty minutes. It may still be reading files or waiting on a build. |
| `abandoned` | Nothing pushed for two hours, with the step still open. Nobody is on it and it was never closed. |

The two marks are `QUIET_AFTER_MINUTES` and `ENDED_AFTER_MINUTES` (#524),
counted from the run's last push or from when it was fired if it has not
pushed. The reading comes off the `plan_runs` row that #568 added columns for,
written by `app/api/plan/runs`, which the plan page calls once it has drawn
(#563) -- so the page appears with what was last stored and updates a moment
later, and the terminal tool, the brief and the send guard read the same answer
without a request of their own. A reading older than the ended mark is not
trusted (#570) and neither is one carrying a GitHub refusal, and in both cases
the clock in `elapsed.ts` answers instead. That fallback is also what a claim
with no run recorded against it gets.

`healthOf` turns those into the healths `working`, `quiet` and `abandoned`, so
the health column, the module counts and bands, the terminal's facts column,
the brief's status line and the send guard all read one function. The guard
counts `quiet` as live: the twenty-minute mark reads wrong on a session that
is reading rather than writing, and #574 settled that a quiet step is re-sent
by asking first.

**What the asking is.** `sendOverClaim` in `lib/plan/liveness.ts` is the whole
rule: a claim nothing is reading and one whose run has stopped go straight
through, a run still pushing is refused as it always was, and a quiet run is
asked about. The question is `quietSendAsk`, and it carries the evidence rather
than the verdict — how long the silence has run and what the last push was —
because "its run is quiet" alone cannot tell a dead session from one waiting on
a build. The guard in `handover.ts` and the three Send doors on the plan page
(the quick icon, the button on the opened row, the row menu) all read that one
function, so the page cannot arm a confirmation the guard would refuse outright
or send something the guard would have asked about. Confirming carries
`confirm=quiet` on the press; the guard takes that as the answer and nothing
else, so a form that never saw the question cannot set it. The run being
replaced is written off first — `endRunsOnStep`, status `failed` with
`runReplacedNote` — because a row still reading `started` under a fresh
session's claim is the older run answering for the newer one. Only the step's
own claim is asked about; another step under the same feature with a quiet run
still refuses, which is #587's answer and #590's step.

**What a run has to show for itself.** One word is the right size for the
health column and the wrong size for a step you opened because it says somebody
is working it. So the opened row carries the evidence behind the word: which
press started the run and when, what it last pushed, which steps closed after
it was fired and what it raised. `lib/plan/work.ts` has those rules --
`runWork` gathers them and `runStartedLine`, `pushLine`, `closedLine`,
`raisedLine` and `nothingToShowLine` are the wording -- pure and browser-safe,
so the terminal and a brief can say the same thing from the same rows.

Nothing there asks GitHub. The push is the reading stored on the run row, and
`github_checked_at` keeps the two kinds of silence apart: a run nobody has
asked about says that rather than reading as a run that pushed nothing, and a
reading carrying a refusal says GitHub would not answer. The closures are read
from the page's catalog rather than from the tree the row is drawn in, because
a view like Open has already filtered out the step a run closed an hour ago.
The raises are the rows whose `source` names one of the run's steps and that
were filed after it was fired -- both halves, since the time alone would hand a
run every raise anybody filed while it was going.

## The reading

`lib/plan/tree.ts` turns the rows into what the page and the CLI show. It is
pure and tested, and it is the only place these rules live.

**Nesting.** Siblings are ordered by position, then age. A step whose parent
is missing is shown at the top of its module rather than lost.

**Waiting.** A step waits on its own unfinished dependencies *and* on those of
every step above it: a feature that waits on another waits with all of its
steps. Done and dropped dependencies are out of the way; a dropped one is
shown plainly rather than freezing the dependent forever.

**Ready.** A step could be picked up now when it is not started, waits on
nothing, has no open sub-steps, and nothing above it is dropped, still
proposed, or blocked on something outside the plan. A
step blocked on the steps it names is ready once every one of them has closed;
a step blocked on something outside the plan never is.
A feature with open sub-steps is worked through them; the feature is what
you close when they are all done — and at that point it is itself ready.

A feature blocked on its own steps is the one block that does not carry down,
settled by #638. A question on one step stops that step, and marking the
feature blocked over it used to take every other step beneath it out of the
runner's reach — #494 and #578 did that on the same day and hid five
priority-one features. What a step really waits on is already a dependency and
is inherited, so the steps genuinely held up stay held up without the parent's
status standing in for all of them. The other direction is read from the steps
instead: a feature whose every open step is blocked reports `blocked` itself,
so nothing is lost by not marking it.

**Roll-up.** A feature's progress is over the leaf steps beneath it, not the
containers in between, and a module's progress is over its leaves, so a
feature with steps is not counted twice. Dropped steps leave the
denominator; in-progress counts as started, not as part done.

**Work order.** Every ready step, most urgent first, and within a priority
in reading order — modules as the switcher lists them, then top to bottom.
Narrowed to Claude it drops decisions, however they are assigned: a ready
decision is ready for the person, not for a session.

**Views.** `?view=` narrows the page to `open` (the default), `you`, `ready`,
`proposed`, `blocked` (blocked by hand or waiting on another), `claude`
(approved steps you did not keep for yourself), `fog`, `dismissed` or `all`. A step that does
not match stays, dimmed, when something beneath it does, so a ready sub-step is
seen in its place. A dismissed step is the one thing `all` does not show:
`dismissed` is where it is, and hiding it everywhere else is what dismissing it
meant.

`open` is everything not done and not dropped — proposals included. It is the
whole of what is outstanding, which is what the word has to mean for the
default view to be worth landing on.

`you` is the part of that which cannot move until the person acts: unanswered
questions, proposals nobody has decided on, and blocked steps. Not their ready
steps — that is work they could do rather than something being asked of them,
and folding it in makes "waiting on you" a list that cannot be cleared.

### What a row reads as

`healthOf` is the one word the page, the counts, the bands, the CLI and the
brief all put on a row, and it is not the `status` column. A question and a
step share that column and do not mean the same things by it, "ready" is worked
out from what a step waits on, and the reading of a claim comes off the run
behind it. `PLAN_HEALTHS` in `lib/plan/tree.ts` is the set, thirteen of them:

| | |
|---|---|
| `unanswered` | An open question. Not "not started" — nothing happens to it until it is answered, and it closes on an answer rather than a commit. One of the three states the *On you* view is made of. |
| `answered` | A settled question. It carries the resolution and no commit, the resolution is its tooltip, and it is the one state the counts beside a module heading leave out: a decision recorded is neither work outstanding nor work that shipped. |
| `proposed` | Written by a session, waiting on the person. Out of the progress denominator and out of the bands, which is what keeps it from being `not_started`. |
| `in_progress` | Claimed, with nothing known about the run behind it: none recorded, or one nobody has asked GitHub about, and the clock has not run out. What every caller that hands in no liveness gets, which is all the status column supports on its own. |
| `working` | Claimed, and the run pushed something inside the twenty-minute mark. |
| `quiet` | Claimed, and nothing pushed since. The guard counts it as live and #574 settled that re-sending it asks first. |
| `abandoned` | Claimed, and the run ended without closing the step. Nobody is on it and it needs handing over again. The one claim reading that leaves the ladder, and it ranks with the stuck states rather than the underway ones. |
| `blocked` | Stopped on something only the person can settle — `block_kind` of `outside`. It stays blocked however much else closes, and Send refuses it. A feature reads it too, when every open step beneath it is blocked and so nothing under it can be picked up. |
| `waiting` | Waits on another step, which clears itself when that step closes. The tooltip names which steps. |
| `ready` | Not started, with nothing in the way. What the Send button takes, `workOrder` lists and the overnight chooser fires. |
| `not_started` | Not started and not ready either: open sub-steps beneath it, or something above it dropped, proposed or blocked on something outside the plan. The right-hand end of the progress bar — work not reached. |
| `done` | Closed against its done-when. The one state that carries a commit. |
| `dropped` | Decided against, and out of the denominator with the proposals. |

**Why thirteen.** #505 asked whether the set had outgrown what anybody reads:
`not_started`, `ready` and `waiting` look like three shapes for "not started,
and here is why". It was measured against one bar — a state stays only if some
surface does something different with it, rather than merely wording it
differently — and all thirteen cleared it. Four pairs were close enough to
argue about. `ready` is what the Send button, the work order and the overnight
chooser read, so merging it into `not_started` puts the one state that is an
invitation to start behind a tooltip. `blocked` and `waiting` stopped being one
fact read twice at #565, which made a `blocked` row reachable with every
dependency closed: one clears itself, the other waits for the person.
`in_progress` and `working` are worded the same and drawn the same on purpose —
they are the same rung, and the live indicator on the row says which — but
dropping `in_progress` means calling a claim nobody has looked into "working",
which is the dot the page used to draw on a step nobody was working. And
`answered` is a closed row with a resolution and no commit, which `done` cannot
say.

The same bar applies to a fourteenth. Every `Record<PlanHealth, …>` is
exhaustive — the glyphs in `lib/status-glyphs.ts`, the words and tones on the
page, the tally, `planState` in `lib/dev/words.ts` — so adding one fails the
typecheck at each surface rather than drawing itself as a proposal, and
`/dev/ui` lists all thirteen with their shapes.

## The page

Each module is a section with its progress bar. Each step is a line: the
status picker (one click changes it), the number, the title, and the facts
that matter — *Next* or *Someday*, the size, *Claude*, *Ready*, *Waits on
#n*, and *done/live steps* on a feature. The chevron folds the sub-steps,
closed by default on a finished step. The title opens the detail: what it
involves, done when, your note, what it waits on and unblocks, dates, the
commit, and the actions — edit, add a sub-step, hand to Claude, send to
Claude. The menu on the line adds a sub-step, edits, moves the step up or
down among its siblings, or deletes it with its count of sub-steps in the
confirm.

A decision is marked where a build step's checkbox would be, with a `?`. Its
health reads *Unanswered* rather than *Ready* — on a question, "ready" would
read as ready to be built, which is the one thing it is not — and its health
menu offers **Answer** first, where a build step offers *Done*; *Done* is not
offered on one at all. Opening it shows a single box, and an answer already
given sits above that box rather than being loaded into it.

The open detail also carries the step's comments, and so does each question in
its questions section — the only place a question can be commented on, since a
decision beneath a step is deliberately not a row of its own in the tree. The
box is closed until asked for. The same thread is on an idea on `/dev/ideas`
and on a raise on `/dev/raised`, where a comment leaves the raise open.

A raise closes two ways and no others. **Yes, do it** runs the action the raise
named when it was filed — the `consequence` column, in the same shape a comment
instruction is carried out in — and the thread says what was done; it is shown
only on a raise that named one. **Close with a reason** takes the reason
nothing was needed. Either way the raise records what it produced, and one that
reached answered with nothing recorded is listed under *Answered, nothing done*
rather than filed with the closed rows: that is what the #342 raise did, read
as handled for a day while the collision it described was still possible.
**Yes, and…** opens a box beside the yes, and what goes in it is read as a
comment on the raise once the action has run.

Editing a step includes moving it: *Part of* lists the module's other steps,
less the step's own subtree. A moved step goes last under its new parent. The
editor also holds the *not yet specified* box; emptying it clears the column.

## The changelog

`/dev/changelog` is the fourth page in the workspace and the only one that
looks backwards. The other three say what is going to happen; this says what
already did — for each day, the plan steps closed and the notes fixed, newest
first, each with the commit that shipped it and a link back to the list it
came from.

**Where a line comes from.** The app's own closed rows, and nothing else: a
`plan_items` row marked `done`, or a `feedback_items` row marked `done`. Both
tables already carry `commit_sha` and `completed_at`, so the changelog needs
no table, no migration and no writing habit of its own — it is a second
reading of rows the plan and the notes queue already maintain. That is the
answer recorded on plan step #122, chosen over generating a file from the git
log at build time: a deployment on Vercel knows its own sha and nothing
before it, so reading history at runtime is not available there, and a
generated file goes stale between releases.

**What deliberately does not appear.**

- **Work done off the plan and outside the notes queue.** A refactor, a UI
  sweep, a fix nobody filed: the app never knew about it, so it has no line.
  This is the standing cost of the answer above, and the reason to close a
  step or a note for work worth remembering.
- **Dropped steps and declined notes.** Both closed; neither shipped, and a
  changelog listing them would be claiming otherwise.
- **Anything with no `completed_at`.** The trigger sets that column from the
  status, so a `done` row without one was edited around the app rather than
  closed through it, and there is no day to file it under.

**How it reads.** Days come from the entries rather than off a calendar, so a
day nothing shipped on has no heading. The day is the UTC date of the instant
the row closed, matching the activity feed on the job side rather than the
account's timezone — one grouping rule across the app is worth more than a
heading that is right about the evening. An account with nothing shipped gets
an empty state, not a blank page.

The reading is `lib/changelog/entries.ts`, pure and tested in the shape
`lib/plan/tree.ts` has; the two queries behind it are `lib/changelog/load.ts`,
each filtered by user and status and capped at 200.

**Not filterable by module in v1.** The list is short enough to read straight
through. Whether any of this should ever face the user outside `/dev` — a
"what's new" on the front page — turns on whether lines written for a builder
read as history to somebody who did not build them, which cannot be judged
until the page has been lived with.

## Claude

Three ways in, all landing on the same rows.

**The CLI.** `npx tsx scripts/plan.ts` with `DATABASE_URL` set:

```
next [--claude]     what could be picked up, most urgent first
list [--all]        the tree, per module
show <n>            the brief
ideas               ideas not yet shaped into the plan, dismissals left out
idea "…" [--module <id>] [--from <n>]   a follow-on, filed as a suggestion
add "…" --parent <n> [--done-when "…"] [--size s|m|l] [--claude] [--proposed] [--idea <id>]
                    [--fog "…"] [--kind decision|setup]
needs "…" --for <n> [--detail "…"]   a setup job of the person's, and the edge to it
approve <n>         a person's move: the step and the proposed steps beneath it
answer <n> --note   a person's move: closes a decision on its answer, no commit
start | done | block | drop | reopen | assign | priority | depends | undepend
```

`done` records the HEAD commit and names the steps that became ready;
`answer` does the same without a commit. `start` refuses a proposal, and
refuses a decision or a setup step, naming where each is closed instead. `next` and `list` mark a decision `(?)` rather than with
a checkbox, and print a step's fog beneath it.

**The brief.** `lib/plan/brief.ts` writes a step out for whoever is about
to build it: where it sits, the feature's *destination* and the decisions
already settled beneath it, what it involves, done when, anything *not yet
specified*, what it waits on (its own and inherited), its sub-steps as a
checklist, what it unblocks, the note. A decision leads with its question
instead. It is what `show` prints and what *Send to Claude* sends.

**Send to Claude.** The button on a step fires the
same routine the notes queue uses (`fireFeatureRoutine`, with
`CLAUDE_API_KEY` and optionally `CLAUDE_FEATURE_ROUTINE_ID` on the
deployment), with the brief as the extra turn. The session that wakes up is
told which step it is for and to follow `.claude/skills/plan`.

**Re-shape.** The return trip, and the answer to a plan that goes stale the
moment anything is learned. Shaping runs once, before anything is built;
from then on the feature is a fixed drawing of a thing still moving —
answering a decision recorded the answer and changed nothing else. The
button on a feature fires the same routine with a *re-shape* turn instead
of a build one, carrying the feature, its fog, its open steps and every
answer settled beneath it. The session graduates fog that the answers made
specifiable into proposed steps and clears the patch, drops a step an
answer made pointless with the reason, and writes any question an answer
surfaced as a fresh decision.

On request rather than on every answer: several questions are usually
settled in one sitting, and one session that has read all of them proposes
better than three racing over the same feature. It also keeps answering
independent — the answer is recorded by its own action, so a re-shape that
cannot start loses nothing. Everything it writes is `proposed`, and nothing
it proposes is started; the plan adapts continuously and still changes only
on an approve. It refuses a proposal, which has nothing agreed to adapt,
and a leaf step, which has nothing beneath it to re-read.

**The skill.** `.claude/skills/plan/SKILL.md` is the front door: which steps
are Claude's, how a batch is run, and where each job is written down. The jobs
themselves are one file each under `reference/` — building a step, shaping an
idea, re-shaping a feature, answering an `@dash` comment, plus the wording
rules and the SQL for when the CLI cannot run. A session reads the front door
and the one file it was sent for, rather than all seven jobs to do one of them.

`reference/building.md` is the per-step procedure: read the brief, check what
it waits on, claim it, break it down if it is large, build to the done-when,
verify, commit with `(plan #n)` in the subject, close with a note.

A batch is not built by the session that receives it. More than one step means
each step goes to its own subagent, which reads `reference/building.md`, builds
that one step and reports back a paragraph. The orchestrating session never
opens the step's source files. This is what stops a long feature ending
halfway: a session that builds nine steps itself carries everything it read for
the first through every turn of the last, and runs out of room around the
third. The subagents also skip the full test suite and `next build` — the
orchestrator runs both once before it pushes, and CI runs them again on main.

A step assigned to Claude is Claude's to pick up; a step named by the user is
Claude's whoever holds it; anything else, ask. The plan must always tell the
truth: a step that cannot be finished is blocked with the question, never left
in progress and never closed to look tidy.

## What is deliberately not here

- **Labels, projects, cycles, estimates in hours.** The module is the
  project; the tree is the grouping; the size is the estimate.
- **Drag and drop.** Move up and move down are two clicks and cannot drop a
  step somewhere by accident. Moving between parents is a select in the
  edit form.
- **Reading the plan from the docs again.** See *Where it came from*.

# Goals

A workspace for the things you are working towards in your own life, run the
way `/dev/plan` runs the app: a tree of what has to happen, with Claude doing
the parts it can and your parts showing up as a short list of things to do.

## What changes from the dev plan

On `/dev/plan` most steps are Claude's. A session picks one up, builds it and
closes it on a commit, and the steps that are yours are the exception: a
decision to answer, a key to supply.

For goals the ratio is the other way round. Going to an event, sending an
application and lifting the weight are yours, and most goals are mostly that.
So the design is judged on two things:

1. **How little it asks of you.** You give what you can, in whatever form, and
   it works with that. A sentence typed on your phone is enough input.
2. **What Claude does with the rest.** Breaking goals down, researching,
   drafting, scheduling, and reading progress from the modules that already
   know it.

## The three levels

Each level has one test, and a thing that fails it belongs at another level.

**Areas** are directions that never finish, named as nouns: Money, Career,
The city, Relationships, Health. An area has no done-when. It holds a
sentence of what you want from it (its note), the goals that serve it, and
its own page (`/goals/area/<id>`). A name that reads as an outcome, such as
"Get a job", is a goal in the wrong place: it ends, so it goes under an area
as a goal (Career, then *Land your next role*).

**Goals** are outcomes that end. A goal sits under an area and has a
done-when describing a state of the world that will be true: pay off the
student debt, land your next role, know ten people in the scene by name,
bench 200 lbs. It may start vague, with fog in place of the done-when.
**A goal is never a practice.** "Go to one urbanism event a week" and "apply
every week" are ways of getting somewhere, not somewhere to get; the goal is
the outcome they serve, and they go inside it as rhythm steps. The app
refuses a goal whose title or done-when reads as a rate or a streak ("a
week", "every morning", "kept for eight of ten weeks") and says what to
write instead, and the database refuses one from Claude
(`migrations-goals/0041`).

**Stages** are the top level of a goal's tree when it has one: three to six
parts of the path, in order, each with a done-when of its own and steps
beneath it. *Land your next role* runs from knowing the target to saying
yes. The goal page draws each stage as its own card, "Stage 1 of 6", and a
stage closes itself when every step under it is closed
(`migrations-goals/0040`). A goal whose parts are independent outcomes is
several goals instead; parts that follow one another toward one done-when
are stages.

**Steps** sit under a stage or directly under a goal, and a step can have
sub-steps to any depth. Each step is one of four kinds:

| Kind | Whose | Closes when |
|---|---|---|
| `mine` | yours | you say you did it |
| `claude` | Claude's | the thing it produced exists: a research note, a draft, a list of events |
| `decision` | yours | you answer the question on it |
| `rhythm` | yours | never; it is kept or missed, week by week |

Goals that are mostly yours, like knowing people in the scene, still get the
full tree. The map of what has to happen is useful even when Claude can do
none of it.

### Rhythms

A practice is a rhythm step inside the goal it serves: *attend one urbanism
event a week* inside *Know ten people in the scene by name*, *send five
applications a week* inside the applying stage of *Land your next role*,
*log each balance monthly* inside *Pay off student debt*. A rhythm has a
target count per period, and progress on it is whether the recent periods
were kept. It never shows as done. An area's page lists the practices of all
its goals together, with this period's progress.

Todo has no repeating tasks today (`lib/todo/tasks/model.ts` has no
recurrence), so the rhythm lives in Goals and shows on Todo through the agenda
source described below, as an item for the current period until that period's
count is met.

### Fog and refining a goal

A goal can go in vague. "Get fit" is written with **fog**, the same field the
dev plan uses for a feature nobody can specify yet: one honest paragraph
saying what is not known. Claude then asks one or two questions as `decision`
steps ("strength or endurance? where are you now?") and, once they are
answered, proposes concrete goals beneath it, such as *bench 200 lbs by March*.
This is the shape and re-shape flow from `.claude/skills/plan`, pointed at a
goal instead of an idea.

### Planning an area

Sometimes the direction is clear and the goals are not. "Get plugged into the
city" says where you want to go without saying what would get you there. An
area takes a sentence saying what you want from it (`areas.note`), and **Plan
this area** fires one run that proposes the goals the area needs: three to
six, covering the main ways in (knowing the subject, showing up, knowing
people, joining something, making something), each with a done-when, a
sentence on why it serves the area, and one first move beneath it.

The goals arrive as proposals. You approve the ones that fit on each goal's
page and archive the rest, and turning one down is how you tell Claude which
reading of the area you meant. **Work on this** on an approved goal then maps
it in full. Once the area has goals, the button reads **Plan what is
missing** and proposes only what the existing goals leave out, never
something you turned down. The rules for the run are in
`.claude/skills/goals`, "Planning an area".

## Approval

Claude proposes; you approve. On the dev plan every proposed step waits for
approval separately, which at goal scale would be a lot of tapping. So approval
happens once per goal: you approve a goal's first breakdown, and after that
Claude may add, reorder and split steps beneath it without asking. It may not
add a new goal, change a goal's done-when or drop one of your steps without
approval. Those stay proposals.

## Where things live

A goal's steps live in Goals. What they refer to lives in its own module, and
Goals links to it:

- **Learn.** The learning goals at `/learn/goals` (the `aims` table) stay in
  Learn. A goal can link aims beneath it, so *get plugged into city life* can
  hold *learn urban planning basics* without the aim moving. Goals is the
  parent; Learn keeps what it already owns.
- **Jobs.** *Get a job* reads applications, interviews and reminders from the
  job search tables to show progress. Nothing is copied.
- **Todo.** Covered next.

One action can serve several goals. A volunteering shift counts towards the
city goal and the friends goal, so a step or a logged event can be linked to
more than one goal, and each goal's view shows it.

## Pulling in from the other modules

Much of what a goal needs is already written somewhere else in the app: what
you want from the next job in the job search's thoughts, a vault note on it,
a Learn aim for the skills, the applications themselves. Goals reads those
rather than asking again. Two kinds of thing come across, and they are
handled differently:

- **Progress another module owns** (applications sent, articles read) is
  linked and read live, as above. Nothing is copied.
- **What you have said or thought** (a thoughts entry, a note) is found by
  search, and what bears on a goal is kept on it as **context**: a row in
  `goals.context` naming the table and row, one sentence on why it matters
  here, and the words that do. The goal page shows it under "From your other
  modules", each linking back to where it lives. Facts from it fill the
  goal's collections as drafts, with `source = 'app'`.

**Where to look is a catalogue, not a rule per goal.** Each module declares
its tables in a `sources.ts` beside its own code (`lib/jobs/sources.ts`,
`lib/vault/sources.ts`, …): what a table holds, which columns to search, how
to name and link a row, and whether it says what you want (`intent`), what
you did (`record`) or only mentions things (`incidental`). Tables that are no
use to Goals are listed as not a source, with the reason. `lib/sources`
gathers them, and `npm run sources:write` writes the list the goals routine
reads (`.claude/skills/goals/reference/sources.md`). Claude chooses sources
from what they hold, so a career goal finds a vault note on work without
anything saying "career means the vault".

**The catalogue cannot fall behind.** `tests/sources-catalogue.test.ts`
reads every table the migrations create and fails the gate on one that is in
neither list, naming the file to change. A session that adds a table has to
decide whether Goals should read it before it can merge. The routine also
reads table comments, and names in its run summary anything useful it found
outside the catalogue, which catches a new column on an old table.

**You decide what stays.** Context Claude finds on a goal you have not
approved is proposed, with Keep and Not relevant on each row; after approval
it may keep it outright. A dismissal is final for Claude: the database
refuses a change to a dismissed row and a second row for the same thing
(`migrations-goals/0032`).

**Search wide, read narrow.** Finding notes costs a query; reading them
costs the run's time and allowance. The vault is about 1,300 notes, far more
than one run can read, so a run searches by theme and full text for names
and highlighted lines, reads in full only the handful that bear on the goal,
and on later runs starts from the kept context and looks only at what
changed since. The weekly run does the same for everything written that
week.

Claude reading vault content is settled: the app has one user, who has said
the vault is open to it.

## Todo

This follows the rule in [TODO-SPEC.md](TODO-SPEC.md): an obligation is shown
by whoever needs to show it and written by whoever owns it. A goal step is
owned by Goals and is never copied into `todo.tasks`.

- Each `mine` step has a **Show on Todo** button. Pressing it sets a flag on
  the step, and a new agenda source (`lib/todo/agenda/sources/goal-steps.ts`,
  beside `job-reminders.ts`) reads flagged steps at query time.
- Ticking the item on Todo closes the step in Goals, because it is the same
  row. Dismissing or deferring it on Todo writes only a dismissal, as for every
  other foreign source.
- Rhythms for the current period appear on Todo on their own until the count
  is met. There is no flag to set for those.
- Dated items, such as an event you said you would attend, show on their date.

Nothing is written to Google Calendar. Todo reads calendars through iCal feeds
and cannot write to them. That would be a separate integration, and it is not
planned.

## Capture

One box, reachable from every page on phone and laptop, where you write what
happened in plain words:

> went to the Van Alen talk, met someone from a transit nonprofit, want to
> volunteer there

It is filed as follows:

1. A direct model call reads the sentence against your open goals and steps
   and returns what to do: close a step, log progress against one or more
   goals, add a follow-up step. This takes seconds, the same fast path `@dash`
   replies use.
2. The page shows what was filed, as a short list, each line with **Undo**.
   It will sometimes attach a note to the wrong goal, so seeing the result and
   reversing it in one tap is required.
3. Anything that needs research, such as finding that nonprofit's volunteer
   sign-up, becomes a `claude` step for the next scheduled run. Capture does
   not fire a routine itself.

Capture registers as an action in `lib/capture/actions.ts`, which exists for
this purpose.

## What Claude does, and when

Every automated job is a routine run. Runs count against the Claude plan's
usage and daily routine limits, and the dev plan and overnight runner draw on
the same allowance. So Goals runs on a schedule rather than on every change:

- **Daily, early morning.** When a `claude` step is ready, one run works up
  to ten of them (`DAILY_STEP_LIMIT` in `lib/goals/daily-run.ts`) and the
  rest wait for the next morning. You open the app about once a day, so this
  is when the work has to be ready. The morning run does not map new or
  foggy goals; the night run does that.
- **Overnight.** While the overnight runner on `/dev/plan` is started, it
  maps each open goal that has no map yet or whose fog you changed, at most
  once a night, and then works ready `claude` steps one at a time between
  features. See "Claude's
  own work" below.
- **Weekly.** A verdict on each open goal against its done-when: on track,
  stalled or waiting on you, with one sentence on why and the next move,
  shown on the goal's card on the Goals home. A goal with nothing done in
  three weeks reads stalled, and its next move is proposed as a step
  (plan #1018). Then research for each goal of the kinds of help it asks for:
  events, volunteer openings, reading, courses or job leads (plan #1028).
  Each suggestion carries its kind and has quick **going / not for me**
  buttons, and the next week's research for a kind reads the reactions to
  that kind. Going puts it on Todo on its date. From the day after, the home
  asks "Did you go?" with yes and no, for up to two weeks, and a tick on Todo
  counts as yes; the brief reads the answer beside the reaction (plan #1020). Sources such as Eventbrite,
  Meetup and org newsletters vary in how reachable and current they are, so
  the first few weeks will be uneven and should improve with the feedback.
- **On request.** A **Work on this** button on a goal fires one run for it,
  and **Plan this area** on an area fires one run proposing its goals. One
  step or phase can be sent on its own, and one of your steps can be
  prepared, as described in "Claude's own work" below.
- **After an answer.** Answering a question on a goal fires one run for that
  goal once ten minutes pass with no further answer, so several answers in
  one sitting cost one run. It settles the provisional steps the answers
  held up and proposes anything new (plan #1017).

## Claude's own work

Besides the scheduled runs, you can hand Claude one part of a goal, and the
overnight runner works Claude steps while you sleep. Every way in goes
through one hand-over, `sendGoalStep` in `lib/goals/handover-store.ts`, so
each refuses the same things and writes the same run row and brief.

### Sending a step or a phase

A Claude step with nothing under it has **Send to Claude** on its row. A step
with sub-steps is a phase, whoever's it is, and has **Send this phase to
Claude**. Pressing either writes a `goals.runs` row with job `step` or
`phase` and `item_id` on the step, then fires the goals routine with a brief
that names the step first, followed by its goal, where it sits, the steps
beside it, a phase's own steps and the collections the goal fills.

A sent step is worked as the morning run works one: Claude produces what it
asks for, stores it in the step's `result` and closes it, touching no other
step. A sent phase has its open Claude steps worked in order. Your own steps
and questions in it are left alone, and the run stops at the first step that
needs you.

The rules are `sendRefusal` in `lib/goals/handover.ts`. A send is refused,
with the reason shown on the row, when:

- the step is a question;
- the goal is not approved, or is done or dropped;
- the step, or a step above it, is still a proposal;
- the step is done or dropped already;
- the step or a step above it is blocked;
- a single step waits on another step that is still open;
- a phase has nothing open under it;
- Claude is already on the step, on the whole goal, on a phase the step is
  part of, or on a step inside the phase.

### Preparing one of your steps

One of your steps with no sub-steps, such as calling a servicer or sending an
application, has **Ask Claude to prepare this**, and **Prepare it again** once
it has a result. A rhythm is yours too, but it repeats, so it is not offered.
The run has job `prepare`. Claude writes what you need to do the step: a
draft email, a call script or numbered instructions, naming the real
servicer, account and amounts from the goal's collections and your email. It
is stored in the step's `result`, which goals migration 0023 lets a `mine`
step hold. The step stays yours and open, ticking it is still yours, and
preparing it again replaces the text.

The refusals are the same as for a send, except that a step may be prepared
before the steps it waits on have closed.

### From a comment

The quick `@dash` reply on a step (`lib/goals/comment-model.ts`) has four
outcomes: answer, file facts as drafts, pass the comment to the goals
routine, or take the step. When it takes the step, `commentMode` picks the
job: a step of yours with no sub-steps is prepared, and anything else is
sent (`lib/goals/ask.ts`). The comment goes into the brief under "What they
wrote", and the run treats what it says about the result, such as shorter or
addressed to someone, as part of the step's done-when.

The reply in the thread says what happened, including a refusal ("I did not
start it: …" with the reason). On the goal itself there is no single step to
take, so a comment asking Claude to work on the goal fires the whole-goal run
(job `goal`), as **Work on this** does.

### Progress while a run goes

The goals skill reports at each step it starts by writing `last_seen_at` and
a short `now_on` line to the run row (goals migration 0024). A run in
progress then reads "on Draft the letter, 3 minutes ago". A run on the whole
goal shows this in the goal page's Claude panel, and the Runs page
(`/goals/runs`) shows it for every run, including a sent or prepared step.
A step's row says it was sent when you press the button and shows the result
once the run closes the step, but it does not show the run itself after the
page reloads.

A run with no report for 45 minutes (`RUN_QUIET_MS` in
`lib/goals/shaping.ts`) is taken to have died. The sweep in
`inngest/goals/quiet-runs.ts` closes each one as failed, with the step it was
last on in the error. It runs on the overnight clock, which pg_cron calls
every four minutes all day, and in the daily cron, so a dead run is closed
within the hour and **Work on this** and **Send** work again. This replaced a
flat two hours in which any started run held its goal.

### The night run

Decision #1006 put goal steps into the dev plan's overnight runner rather
than a runner of their own. The start, pause, stop, budget and stop time on
`/dev/plan` hold goal runs as they hold features, and each goal run takes one
off the same budget. The goals half of each tick (`inngest/goals/overnight.ts`)
runs after the feature half:

- It starts nothing while any goals run is going, so goal steps are worked
  one at a time.
- `chooseNightSteps` in `lib/goals/overnight-choice.ts` orders the ready
  Claude steps: soonest due first, then the goal that has gone longest
  without progress, then page order. It takes one step per goal, and skips a
  goal that already has a run going and a step whose last two runs failed or
  never reported back.
- The first step is sent through `sendGoalStep`, as Send would send it. A
  step the hand-over refuses is passed over for the next one, and a fire that
  fails ends the tick.

What the night did is listed at the top of the Goals home the next morning
(see "Since your last visit" below). The budget field on `/dev/plan` still
says "features" although goal runs spend it too.

### Flags

A run sometimes finds something you should know that is neither a step nor a
question, such as a servicer moving your due date or a statement showing a
missed payment. It flags it: a row in `public.raised_items` with the goal's
id in `goal_id` and module `goals` (goals migration 0031). An open flag is
listed under Waiting on you on the home, after the questions, and opens to
the flag on the goal's page. There it shows what was found, the thread under
it, a box to answer it and **Put aside**.

Answering writes your answer into the flag's thread and starts a goal run
with job `raise`, whose brief carries the flag, the thread and your answer
(`lib/goals/flags-store.ts`). The flag moves to answered, which takes it off
Waiting on you, and the run replies in the thread and closes it. When no run
can start, because a run is already going on the goal or the account cannot
start one, the answer is kept and the flag stays open. Flags are left off
`/dev/raised`, where an answer would start the plan routine instead.

## The daily view

The Goals home page is for a once-a-day visit, and it is sorted by whose
move each thing is, so nothing Claude will do reads as yours and nothing
waiting on your approval looks under way:

- **Your move**, grouped by what it asks of you. *Decide*: questions, and
  what a run flagged. *Approve*: goals Claude proposed, one row per area
  (the All goals page has Approve and Turn down on each, and Approve all for
  an area), and proposed steps on an approved goal. *Read*: a result Claude
  produced, and the context and drafts it found for a goal. *Do*: your own
  next steps across every goal, with the rhythms running out of days.
- **Dash is on it**: the runs going now, the Claude steps the next morning
  run will work, and the Claude steps held until you approve the goal or the
  proposal they sit under.
- **Your goals**: each goal's bar, its weekly verdict and the way into its
  tree.

A phase closes itself once every step under it is closed
(`migrations-goals/0040`), so a finished stage never sits under Do waiting
for a tick.

The full tree for a goal is one tap away and is for when you want to look at
the map, usually on a laptop. It is not the default because a tree of eighty
steps is too much to read every morning.

### Coming back after time away

After a gap, missed items collapse rather than pile up. Overdue `mine` steps
move back to *next* without an overdue badge, missed rhythm periods show as a
single line ("3 weeks missed"), and the page leads with what matters now. The
point is that opening the app after a busy fortnight should not feel like a
debt.

After five or more days since the last visit, the home opens with a catch-up
for the rest of that day: the runs Claude finished while you were away, what
is waiting on you, and one next step per goal, with everything else folded
under it. The last visit is kept in `goals.visits`.

### Since your last visit

On any other day, the home opens with the runs that ended since your last
sitting, newest first (plan #1010): the step each worked, the goal it
mapped with the steps and questions it proposed, the facts it filed, or that
it failed and why. Each line links to the goal it was on, at the step when it
was on one; a morning or weekly run links to its own page. Most of these are
the night run's, but a run carries no mark of who started it, so a run you
started before leaving is listed too.

A sitting is page loads less than thirty minutes apart (`SITTING_MINUTES`
in `lib/goals/catch-up.ts`), and the list reads from the last visit before
this sitting (`goals.visits.previous_visit_at`). Reloading the home, or a
press on it, keeps the list; the next sitting clears it. What each run did is
counted from its `goals.history` rows by `run_id`
(`lib/goals/since-visit.ts`). On a day back from time away the catch-up
lists the runs instead.

## Your examples, broken down

These are the first goals to enter once it exists, and a check on whether the
model fits them.

**Pay off the debts** (Money). You give balances, rates and minimum payments
once. Claude builds the payoff order and monthly targets. After that it asks
for one number a month, the new balances. There is no bank connection.

**Get a job** (Career). Sits over the Jobs module. Claude finds roles and
drafts applications as `claude` steps; you apply and interview. Progress is
counted from Jobs.

**Get plugged into city life in NYC** (The city). Outcomes such as knowing
ten people in the scene by name, with a rhythm of one event a week inside,
fed by the weekly research. Reading and courses go to Learn as linked aims.
After a few events, a `decision` step asks whether the next move is more
education or joining an organization, based on what you marked as worth it.

**Make friends in New York** (Relationships). Mostly yours. A rhythm, a map of
steps, and credit from city events you attended. No people list for now.

**Have good relationships** (Relationships). Starts as fog, refined by
questions into goals you can act on.

## History

Goals keeps a record of everything that happens to it, including what looks
unimportant now. A year of history is what later answers questions nobody has
thought to ask yet: which kinds of events you actually went to, how long goals
of a given size took, which weeks the rhythms slipped, how the debt balance
moved.

- **Every change is an event.** Creating, editing, moving, closing, reopening
  or dropping an area, goal or step writes a row to the history, with the old
  and new values and whether you, Claude or capture made it.
- **Nothing is deleted.** Removing a goal or step archives it. It leaves the
  views and stays in the history. Hard delete is only for rows made by
  mistake, and it is a separate action.
- **Numbers are kept as a series.** Anything measured, such as a debt balance
  or a bench weight, is stored as a dated reading every time it is given,
  rather than overwriting one value.
- **Captures are kept whole.** The sentence you typed is stored as written,
  next to what was filed from it and any later Undo.
- **Suggestions and reactions are kept.** Every event or opportunity Claude
  suggested is stored with your reaction (going, not for me, ignored) and
  whether you then went.
- **Rhythm periods are kept.** Each period records its target, its count and
  whether it was kept, so the record does not depend on recomputing old weeks.
- **Routine runs are kept**, with what each one changed.

The history is written by the database, from triggers on the goals tables,
wherever that is possible. A write that forgets to record itself then cannot
happen.

## Second round: making it useful

The first round built the structure. Using it on the first real goal, *Pay off
student debt*, showed three gaps. The routine wrote two steps and a question
and stopped, because it was told to leave out anything that hung on an
unanswered question. The question arrived with no options. And *List your
loan balances, rates and minimum payments* had nowhere to list them.

### Information steps and collections

A step that needs facts from you carries a definition of what it needs, and
the page draws a form from it: one set of fields, or a table with one row per
item when the definition says so. For the loans step:

```
collection: loans   (one row per loan)
  name       text
  servicer   text
  balance    money     tracked over time
  rate       percent
  minimum    money
  due day    day of month
```

Field types are a fixed list the app knows how to draw and check: text, long
text, number, money, percent, date, day of month, yes/no, choice from a list,
and link. Claude picks fields from that list and never writes a table or a
migration.

- **Collections** (`goals.collections`) hold each definition: a name, the
  fields, whether it is one record or a list, a version number, and the goals
  it belongs to. One collection can serve several goals, so a budget can be
  read by the debt goal and a savings goal.
- **Records** (`goals.records`) hold what was entered, for every collection
  in one table: the collection, the values as JSON, where they came from
  (`typed`, `pasted`, `document`, `gmail`, `comment`, `capture`) with a
  reference to the source, and archiving in place of deletion. History
  triggers cover both tables.
- **Every write is checked** against the definition, whoever makes it. A rate
  must be a percent and a balance must be money; a value that fails is
  refused with the field named.
- **Tracked fields** also write a dated reading to `goals.readings` whenever
  they change, so a balance becomes a series and a chart. A record read from
  a document carries the date the document gives its figures as of
  (`records.as_of`), and its readings take that date rather than the day of
  the upload. Typed values carry none and are read on the day they are saved.
- **A goal's number from a collection.** A goal served by a collection can
  have its number worked out from it rather than typed: the total of a
  field over every record, the latest value, or how many records there are
  (`items.number_from_collection_id`, `number_from_field`,
  `number_from_how`). Drafts and archived records are left out. Whenever
  the collection's records change and the number moves, the database adds a
  reading to the goal, dated by the changed records' `as_of` or today; one
  statement changing several records adds one reading. Setting the source
  adds the first reading, dated today.
- **When the target will be reached.** With a target and at least three
  readings, the number shows the date the target is reached at the pace of
  the latest six readings (a least-squares slope carried on from the latest
  one). A goal with a due date (`items.due_on`, set beside the target) is
  told whether that date is ahead of it or behind it, and by how much. A
  pace that is flat or moving away from the target says so instead of
  giving a date.
- **An ID field.** One text or number field of a list can be marked
  `"id": true`, such as a loan's ID. Reading a newer statement then updates
  the row with the same ID instead of adding a copy, and the preview shows
  the saved value beside each one it would change.
- **Changing a definition** raises its version. Existing records keep their
  values; a new field shows empty; a removed field is hidden but its values
  stay in the record.

- **Worked-out answers.** A step exists to answer something, such as when
  the loan payments start or what they come to a month, and the fields are
  the means (#988). The goals routine works each answer out from the step's
  records and stores it in `goals.answers`: the question, the answer in one
  sentence, and the rows it read with the date of each row's figures. The
  step shows the answers above its figures, each with a line naming those
  rows and that date. Nobody types an answer. When a row an answer read
  changes, or a new row is confirmed in the collection, a trigger marks the
  answer out of date; the step says so, and the next morning run works it
  again (plan #989). Each answer also stores what it states: a date, an
  amount, or neither (plan #1035). A rewritten answer counts as a change
  when its date moves at all, its amount moves by more than 5%, or, for a
  written answer, the routine judges that its meaning changed. The change is
  measured from the answer as it stood when the step last closed
  (`lib/goals/answer-change.ts`).

- **Questions.** The step lists the questions it has to answer, in
  `goals.items.questions`, each with the key its answer carries ("When does
  my first payment fall due?" is `first_payment`). The goals routine writes
  them when it maps the goal, and the person edits them on the step. Editing
  a question's wording keeps its key, so its answer stays with it.

An information step closes when each of its questions has an answer that
names the rows it read and is not out of date (plan #991). Filling every
field does not close it, and a list has no "That is all of them" button. The
database closes the step when the last answer lands or when the questions
change so that every one is already answered, since the routine writes
answers through SQL. A step with no questions never closes itself; the
person closes it. Later steps and runs read the collection and the answers
instead of asking again.

A closed step comes back when a new document changes one of its answers
(plan #997). A date that moves at all, or an amount that moves by more than
5% of the answer the step closed on, reopens it. A written answer reopens it
only when its meaning changes, which the goals routine judges on each
rewrite and stores with a one-line reason (plan #1036): "Nelnet" rewritten as
"Nelnet Servicing" leaves the step closed, and "MOHELA" reopens it. A
rewrite that comes without a verdict is compared on its wording, case and
spacing aside, so a change nobody judged still shows. The answer is marked
changed, and the step shows what it said before, what moved (for a written
answer, the routine's reason) and the document behind it. A statement that confirms the answer re-dates it
and leaves the step closed. A reopened step does not close itself when its
answers are current again; what closes it is decision #1048's, and until
then the person does.

### Four ways to fill a form

1. **Type it** into the form or table.
2. **Paste text or a document.** A paste box and a file picker on the step
   take servicer page text, a statement PDF, a screenshot or a Word file. A
   direct model call extracts values against the definition and shows them
   filled in for you to confirm or correct before anything is saved. The
   original file is kept in storage and the records point to it.

   The same read lists what the document has and the form lacks, such as a
   loan's status, next due date or ID, with a value for each row and a line
   on why a goal might use it. Each has an Add field button beneath the
   rows. Adding one revises the collection's fields, so the definition check
   applies and the version goes up, and the new field is filled in on every
   row of the preview. A suggestion becomes the ID field only when the list
   has none. The read also warns about labels that do not mean what they
   say, such as an NSLDS "Repayment Begin Date" that is the last
   disbursement date for a Grad PLUS loan; those are listed above the rows.
3. **Claude finds it first.** The goals routine has the Gmail connector. When
   it writes an information step it searches for what it can (loan
   statements, offer letters, receipts), fills in what it found as a draft,
   and names the email each value came from. You confirm it.
4. **Say it** in a comment on the step or in the capture box, and it is filed
   into the same collection.

### Fuller maps

The goals skill changes from *leave out what hangs on a question* to *lay out
the whole path and mark what is provisional*. A new goal gets its phases from
the start, each with sub-steps, with `claude` steps wherever Claude can do the
work, information steps with their definitions, and questions with lettered
options. Steps that depend on an answer are written anyway, marked
provisional, and re-shaped once it is answered. A question with fewer than two
lettered options is refused by the database.

For the debt goal the first run would write: get the numbers (an information
step, pre-filled from Gmail); choose avalanche or snowball, with a Claude
step checking whether refinancing, income-driven repayment or forgiveness
applies; build the month-by-month schedule and payoff date (Claude); set up
autopay (yours); then log the balance monthly and a quarterly Claude review.

### Taken from the dev plan

The dev plan page already has these, and Goals reuses the components rather
than rebuilding them:

1. **Question buttons**, from `components/dev/question.tsx` and
   `lib/plan/options.ts`: the lettered options as buttons with the
   recommended one marked, a written answer still possible, and Not now and
   Change answer beside them.
2. **Comments and @dash** on every goal and step, from
   `components/dev/comment-thread.tsx`. The reply path needs a goals version
   that writes out the goal, its collections and its steps for the model, and
   hands anything bigger to the goals routine.
3. **Status words and colours**: On you, With Claude, Waiting, the health
   glyphs with their tooltips, a progress bar per goal, and the question
   marker on rows waiting on you.
4. **Read-only detail**: an opened step shows its detail, Done when and Needs
   as text, with Edit as a separate action.
5. **Proposals and fog**: approve or reject one proposed step, and the goal's
   fog shown under it.
6. **Run status**: Claude is working on this while a run is going, and what
   it changed once it ends.
7. **Blocked and waiting steps** (plan #981): a step can be blocked with one
   sentence saying what it needs, shown as its Needs line, and can wait on
   other steps. A waiting step reads as Waiting and becomes ready by itself
   once the steps it waits on close, by the rules `isReady` and
   `isStaleBlock` apply on the plan. A step blocked on you is On you. Only a
   step can be blocked, never a goal.

Priority, filters and search stay on the dev plan for now.

## Not in this version

- A people list (names, where you met, last contact). Deferred by choice.
- Writing to Google Calendar.
- Google Drive exports, such as a debt tracker spreadsheet. Possible later by
  attaching the Drive connector to the routine. When it comes, the app holds
  the numbers and the sheet is a view of them; editing the sheet does not feed
  back.
- Bank or card connections.

## Data

A sketch for the migration, not the migration itself.

- `goals.areas`: id, user_id, name, note, position.
- `goals.items`: the tree. One table for goals and steps, as `plan_items` is
  one table for features and steps. `area_id` on top-level rows, `parent_id`
  below them, `level` (`goal` or `step`), `kind`, `status`, `title`, `detail`,
  `acceptance`, `fog`, `resolution`, `due_on`, `on_todo`, `approved_at`,
  `position`, and `rhythm_count` with `rhythm_period` for rhythms. A goal's
  `help_kinds` lists the weekly help it asks for, each an entry of `kind`
  (events, volunteering, reading, courses or job_leads) and a `note` on what
  to look for (plan #1027). When Claude maps a goal it proposes kinds in
  `proposed_help_kinds`, the same shape, for the person to approve, change or
  turn down on the goal page; `help_kinds_settled_at` records when the person
  last saved the goal's help, and Claude proposes only while it is null (plan
  #1029).
- `goals.item_goals`: extra goals a step counts towards, beyond its own
  parent.
- `goals.links`: a goal or step to a Learn aim, a job application, a role.
- `goals.history`: one row per change to any goals table, written by
  trigger: table, row id, action, old and new values, actor (`me`, `claude`,
  `capture`), capture id where there is one, and time. An Undo on a run's
  page (/goals/runs/<id>) is recorded as yours with the change it took back
  (`undoes`, and `undoes_field` for one field of a collection). Append-only.
- `goals.captures`: each capture sentence as typed, what was filed from it,
  and when any of it was undone.
- `goals.readings`: dated numeric readings against a goal (a balance, a
  weight, a count), never overwritten.
- `goals.periods`: one row per rhythm per period, with target, count and
  whether it was kept.
- `goals.suggestions`: what Claude suggested, the kind of help it is, your
  reaction, and whether it happened.
- `goals.reviews`: the weekly verdict on each open goal, with why, the next
  move, the step proposed for a stalled one, and the run that wrote it.
- `goals.runs`: one row per routine run, as `plan_runs` does for the dev plan.
  `job` says what fired it (`daily`, `weekly`, `goal`, `reshape`, `step`,
  `phase` or `prepare`), `item_id` the goal or step it is on, and
  `last_seen_at` with `now_on` its last progress report.
- `goals.dependencies`: one row per step that cannot start until another
  step closes, with the loop and same-account checks `plan_dependencies` has
  (plan #981). `goals.items` carries `block_ask` and `block_kind` for a
  blocked step.
- `goals.answers`: the answers the routine worked out on an information
  step, one per question (`key`), with `sources` naming the records read and
  each one's `as_of`, `worked_at`, and `out_of_date_at` once a record it read
  has changed (plan #989). `kind` (`date`, `amount` or `text`) with
  `value_date` or `value_amount` holds what the answer states, and
  `closed_answer`, `closed_date` and `closed_amount` hold it as it stood when
  the step last closed, written by a trigger on the step (plan #1035).
  `changed_at` and `changed_record_id` mark a rewrite that changed the answer
  and reopened its step, and the row behind it, until the step closes again
  (plan #997). `meaning_changed` and `meaning_reason` hold the routine's
  verdict on its latest rewrite of a written answer; a rewrite that does not
  renew them clears them (plan #1036).
- `goals.comments`: the thread on a goal or a step, `me` or `claude` per
  message (plan #957). A reply can file facts into a collection as drafts.
- `archived_at` on areas and items, in place of deleting them.

Its own schema, as `job_search` and `todo` have theirs, with row level security
on every table. Reusing `plan_items` itself was considered and rejected: its
kinds, commit column and routine assumptions are about building software, and
mixing personal goals into the dev plan's tables would put them on `/dev`
surfaces that other signed-in accounts cannot see and should not.

## Build order

Filed on the plan as a proposed feature. Each is one step.

1. The workspace and its tables: `goals` in `lib/modules.ts`, the schema
   above with history triggers and archiving, and an empty Goals home.
2. Areas and goals: add, edit, reorder, archive; fog on a goal.
3. The step tree with sub-steps, the four kinds, and the full-tree view.
4. The daily view, with the next items per goal and what is waiting on you.
5. Show on Todo: the flag, the agenda source, ticking closes the step.
6. Rhythms: period rows, the at-risk line, the Todo item per period.
7. Capture: the fast filing call, the filed list with Undo, captures kept.
8. Readings: dated numbers against a goal, and a small chart of them.
9. Links to Learn aims and Jobs, and progress read from them.
10. The goals routine and skill, shaping goals with approval once per goal.
11. The daily run working `claude` steps.
12. Weekly research for rhythm goals, with suggestions and reactions kept.
13. Coming back after time away.

Second round, filed as its own feature:

14. Collections and records, checked writes, tracked fields to readings.
15. The form or table on an information step.
16. Filling a form from pasted text or a document, with confirmation.
17. Question buttons, Not now and Change answer.
18. Comments and @dash on goals and steps.
19. Status words, colours and progress per goal.
20. Read-only step detail.
21. Approving or rejecting one proposal, and fog on the page.
22. Run status on a goal.
23. The skill: full maps, information steps, Gmail pre-fill, options required.

Third round, plan features #999 and #1005:

24. Send a Claude step or a phase from its row (#1000).
25. Prepare one of your steps (#1001).
26. Progress reports and the 45-minute cutoff (#1002).
27. Taking a step from an `@dash` comment (#1003).
28. Goal steps in the overnight runner (#1007, #1008), with mapping at night
    (#1009) and the list of what the night did on the Goals home (#1010).

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
parts of the path, each with a done-when of its own and steps beneath it.
*Land your next role* runs from knowing the target to saying yes. They are
listed in the order they roughly happen, but the order does not hold work
back: the morning run works a ready step in any stage, so building a
network can go on while the résumé is still being written. Where the order
matters, a dependency says so (a step that waits on a step in another
stage, under "Blocked and waiting steps"), and that is the only thing that
holds a stage back.

The goal page opens every stage under way under its own "Stage 3 of 6"
heading: the first stage neither finished nor held, and any other stage
with a step done or a result from Dash. It folds every other stage to one
line saying whether it is done, how far along it is, or which stage it is
waiting on ("1 step · waiting on stage 2"). A stage waits when a step in
another stage holds it, by a dependency on the stage itself or on every
open step in it. A track of all the stages sits under Dash's status. A
stage closes itself when every step under it is closed
(`migrations-goals/0040`), whatever state the stages before it are in.

A goal whose parts are independent outcomes is several goals instead;
parts that serve one done-when are stages, even when some of them run side
by side.

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

### Steps for later

Some steps belong in a goal's map long before they can be done. Turning on
autopay for the student loans is part of paying them off, but nothing is due
until December, so it is a job for November. A step takes a **start date**
(`items.starts_on`, `migrations-goals/0043`), the first day it can be done,
set from Start when you edit it or by Claude when it maps the goal.

Before that day the step, and everything beneath it, waits:

- it is left out of the home's next steps, and a question under it is not
  asked yet;
- the morning and night runs do not work a Claude step for later;
- a step shown on Todo appears on its start date, or on its due date when it
  has one;
- a rhythm for later counts no periods, so it cannot be missed before it
  starts;
- on the goal page it reads "Starts 1 Nov" and counts as waiting, not as on
  you.

On the day it becomes an ordinary open step. A start date is for waiting on
the calendar; waiting on another step is a dependency ("Blocked and waiting"
in the goals skill). Only steps take one, and a step with both dates starts
on or before the day it is due.

### Fog and refining a goal

A goal can go in vague. "Get fit" is written with **fog**, the same field the
dev plan uses for a feature nobody can specify yet: one honest paragraph
saying what is not known. Claude settles what it can from the person's notes
and its own judgement, and asks as a `decision` step only what it cannot
settle ("where are you now?"). Once that is answered it proposes concrete
goals beneath it, such as *bench 200 lbs by March*. Questions are the
exception: the goals skill's "Decide first, ask last" gives the test, and a
choice Claude made shows on the steps it shapes as a `Decided:` line the
person can overrule.
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

### Errands

An errand is a one-off job with a date, such as finding a birthday present or
booking a car service. It is a goal with `errand` set and a `due_on`, and the
database refuses an errand without the date.

**Add an errand** on the Goals home takes what the job is, the date it is due
by and the area it goes in, which starts on the area of the soonest errand
(or the first area). One press saves it and starts a goal run whose brief says
it is an errand and when it is due, so Dash maps it as the goals skill's "An
errand" says: three to five steps with no stages, its own research worked in
the same run, and no weekly help. If the run cannot start, because no goals
routine is set or the fire fails, the errand is still saved and the message
says why Dash did not start; **Work on this** on its page tries again.

The home lists open errands under **Errands**, above the areas, soonest due
first, each with its date. An errand is not listed under its area as well.
Its own page shows the due date beside the title and leaves out the stage
track and weekly help. The goal's menu turns any goal into an errand or back.

**Hand to Dash** on a Todo task makes the same errand from the task (plan
#1263): its title, its notes as the errand's detail, the area you pick and the
due date, which starts on the task's own. The save and the run are one helper,
`saveErrandAndStart` in `lib/goals/errand-store.ts`, which Add an errand calls
too, so the two cannot drift. The task is ticked off and links to the errand.
Every other start of a goal run (Work on this, the overnight map, an answered
flag and a comment to Dash) briefs an errand as an errand.

## Approval

You approve what Claude does outside the plan, and the goals it proposes. You
do not approve its steps. Research, a comparison, a draft or a calculation
changes nothing beyond the goal's own map, so a goal you add is approved as you
add it, and Claude adds, splits and reorders steps under it without asking
(`migrations-goals/0042`).

What waits on you:

- **A goal Claude proposed**, with the steps under it, since adding a goal is
  deciding what you want. Approving the goal opens them all.
- **A step that acts outside the plan**: sending an email or a message,
  submitting a form or an application, booking or buying, posting or sharing,
  or changing your records outside Goals. It is a Claude step whose `acts`
  holds one sentence naming what working it does ("Sends the hardship request
  to help@nelnet.net from your Gmail"). It arrives proposed, the row shows
  the sentence with Approve and Turn down, and no run works it until you
  approve that step. The database refuses Claude writing such a step in any
  other status, opening one, or changing what a live step does.
  Dash may not notice that a step acts, so the app checks as well (plan
  #1183): before a goals run starts, and when you press Work on this or Send,
  Jev is asked about every open Claude step with no sentence. A step it gives
  a yes of 0.3 or more goes back to proposed with a sentence Haiku writes,
  through `goals.hold_acting_step` (`migrations-goals/0058`), which writes it
  as the app rather than as Claude. The report-only trial is
  `docs/trials/2026-09-29-goals-hold-acts.md`.

Claude may still not change a goal's done-when, drop one of your steps or
answer a question for you. It asks those as a question step. The exception is
a duplicate: when two of your steps ask for the same thing, Claude merges them,
dropping one with `merged_into` naming the step that now carries its work
(`migrations-goals/0048`). The merge is one line in the run's changes and on
the Goals home, "Merged X into Y", and its Undo reopens the dropped step. A
sub-step merged into its own phase leaves the phase open, and that phase then
waits for you to tick it off rather than closing with its other sub-steps. A
step that waited on the dropped one is made to wait on the survivor too
(`migrations-goals/0049`).

Claude also closes one of your steps when it sees the step happened (plan
#1082): an application logged in Jobs, an event on your own calendar whose
day has passed, a ticked Todo task, or an email from the other party
confirming the exact thing. The morning run looks for this while reviewing
each goal. The close sets `evidence`, one line naming what was seen and when,
and `evidence_source` (`jobs`, `gmail`, `calendar` or `todo`) in the same
write. It reads "Closed X: <what Dash saw>" on the run's page and the Goals
home, and its Undo reopens the step and clears the note. The database refuses
Claude closing one of your steps without evidence, or with a sub-step still
open beneath it (`migrations-goals/0050`), and Claude never closes a rhythm.
Which evidence is reliable enough is tuned from the undos: before closing,
the run reads which of its closes you undid, never closes a step again on the
evidence it was undone on, and holds back on a source whose closes you keep
undoing (the goals skill, "Closing a step from evidence").

No step of yours sits for more than a week without a move (plan #1083). The
morning brief lists each open step of yours that nothing has touched in seven
days (its row unchanged, nothing added or changed beneath it, no comment from
you), and the run gives each one move: it splits the step into smaller
sub-steps, prepares it as **Prepare** would, or adds a question beside it
asking whether you still want it and makes the step wait on that question.
Each is an ordinary change on the Goals home with an Undo. If you answer that
you no longer want it, the re-shape run drops the step with `dropped_on`
naming the question, which the database allows only for a question the step
waits on and you have answered (`migrations-goals/0051`). It reads "Dropped X
on your answer to Y", and its Undo reopens the step.

Closing a whole goal stays yours (plan #1084). When the morning run reads a
goal's done-when as met, its status for the day is `met`, with a short
summary of how it got there, and Today offers **Close goal** with it. A goal
with nothing done in three weeks (no step closed as done, no reading logged)
is offered **Park goal**: a parked goal keeps its steps and leaves the home,
Todo and the runs until you press **Take it back up** on the All goals page.
Both offers carry a quiet **Keep it open**, which records `kept_open_at` on
the goal: a met status older than that is not offered again, and the three
weeks count from it. Taking a goal back up counts the same way. The buttons
are your own writes; the database refuses Claude any change to a goal's
status and any write of `kept_open_at` (`migrations-goals/0052`).

A step that depends on an unanswered question is written live but waits on that question,
so it stays out of the runs until you answer.

## Where things live

A goal's steps live in Goals. What they refer to lives in its own module, and
Goals links to it:

- **Learn.** Each learning goal (a row in Learn's `aims` table) is a goal in
  the Learn area here (plan #1490), and Learn has no Goals tab of its own:
  `/learn/goals` redirects to that area, and Subjects links to it (plan
  #1491). The goal owns the wording; how well you want to know it, its plan
  and a way to practise it sit in a Learning section on the goal's page, and
  the Level 3 goal is one press on Subjects. A goal elsewhere can still link
  aims beneath it, so *get plugged into city life* can hold *learn urban
  planning basics*.
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

- Each open goal's **next step of yours** is on Todo with nothing pressed
  (plan #1266). It is one step per goal, the first of the next steps the
  Goals home shows for it: open, nothing it waits on and nothing open under
  it, its start date come, soonest due first and then tree order. So twelve
  goals add at most twelve lines, and a parked or proposed goal, a step that
  waits on another and a step for later put nothing there. A next step keeps
  its own due date on Todo, overdue or not, and one with no date shows today.
  The rule is `goalTodoSteps` in `lib/goals/todo.ts`.
- Each `mine` step also has a **Show on Todo** button, for any step beyond
  the next one. Pressing it sets a flag on the step, and it stays on Todo
  until it is closed; an undated one goes in Someday. A step that is both
  flagged and a goal's next step is listed once, and shows today when it has
  no date. The agenda source (`lib/todo/agenda/sources/goal-steps.ts`,
  beside `job-reminders.ts`) reads both at query time.
- Ticking the item on Todo closes the step in Goals, because it is the same
  row, and the goal's next step after it takes its place. Dismissing or
  deferring it on Todo writes only a dismissal, as for every other foreign
  source. The dismissal is keyed by the step, so **Not this one** on a next
  step hides that step only: the goal has no line on Todo until its next step
  is a different one, because that one was closed, reordered or given a later
  date.
- Each **open question** the Goals home lists as waiting on you is on Todo
  too, today (plan #1267): unanswered, not put aside, not under a step for
  later, on an open goal. It has a button per lettered option, the
  recommended one marked, and pressing one records that option as the answer
  exactly as the option button on the goal page does. The question then
  leaves Todo, and the re-shape run fires from the answer as it does for one
  given here. A question whose options cannot be read shows as a link to it
  on its goal. The rule is `todoQuestions` in `lib/goals/todo.ts`, from the
  same pass of `dailyView` that picks the next steps.
- When Dash has **finished work you have not read**, Todo shows one line
  such as "Dash finished 2 things for you", linking to "What Dash did" on
  the Goals home (plan #1268). The count is the home's results to read, Dash
  steps with a result and no `reviewed_at` (`unreadDashResults` in
  `lib/goals/todo.ts`), so marking a result read takes it off the count. At
  zero the line is not there.
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

While you type, the box guesses which of the five moves the sentence mainly
is (plan #1177). When typing pauses for 300 ms, Jev reads the sentence
against an outline of your open goals and steps, and the box shows its guess
under the field. At 0.8 confidence or more it says what filing will do; below
that it asks you to pick one of the five. The guess or your pick goes to the
filing call as a hint, and you can file without picking. Accounts that have
not turned Jev on see no guess.

It is filed as follows:

1. A direct model call reads the sentence against your open goals and steps
   and returns what to do, as any of five moves: close a step, count
   towards a rhythm, log progress, record a reading of a goal's number, or
   add a follow-up step. This takes seconds, the same fast path `@dash`
   replies use.
2. The page shows what was filed, as a short list, each line with **Undo**.
   It will sometimes log progress on the wrong step, so seeing the result and
   reversing it in one tap is required.
3. Anything that needs research, such as finding that nonprofit's volunteer
   sign-up, becomes a `claude` step for the next scheduled run. Capture does
   not fire a routine itself.

Capture registers as an action in `lib/capture/actions.ts`, which exists for
this purpose.

Progress short of finishing a step is kept as a progress entry on the step
or goal it belongs to (plan #1274): the sentence, the day it happened, an
amount and unit when the sentence gave one ("moved two bags" is 2 bags), or a
rough answer of started, half or nearly when it did not. A step can also
carry the total its entries count towards, such as 12 bags, so the page can
say roughly how much is left. Undo marks an entry undone and leaves the row.
The rules are in `lib/goals/progress.ts` and the reads and writes in
`lib/goals/progress-store.ts`.

Capture writes these entries through its progress move (plan #1275). The move
names the deepest step the sentence fits, or the goal when no step fits, with
a short text, an amount and unit when the sentence gave one, and the day when
it named another one ("yesterday"). A day in the future or more than 60 days
back is ignored and the entry is dated today. A move naming a step it was not
shown, an amount of zero or less, or a unit with no amount is dropped. The
filed line reads `Logged 2 bags on "Move the bags to their spot" in Make the
apartment clean and livable`, or `Logged progress on …: <text>` without an
amount, and Undo marks the entry undone.

A sentence about part of a step's work is progress on that step and never
closes it. "I just moved two bags from the living room to the office" logs
2 bags on the bags step and leaves the step open. Capture closes a step only
when the sentence says the whole of it is finished. The filing prompt, Jev's
description of each move, and the hint line passed on from Jev's guess or
your pick each state this rule, and a confident "close" guess cannot turn
partial work into a close. Lists filed before this, with a goal-only note kept on the
capture, are still shown and undone.

On the goal page an open step with entries reads as under way (plan #1276):
a line under its row gives the summed amount per unit ("7 bags so far") and
the day it was last touched, and its opened panel lists the entries newest
first. Under way is read from the entries, not stored as a status, so closing
the step still means done. A step whose progress is all on steps beneath it
says when and on which one, and the Steps heading says when anything on the
goal last moved. A step with no entries looks as it did before.

A step with an estimated total says roughly how much is left (plan #1277).
Its line reads "7 of about 100 bags, about 93 to go", and at or past the total
"the estimate reached", never a percentage. Its details say "About 100 bags in
all", and Edit has the total and what it counts side by side; clearing the
number clears both. Entries count towards the total when their unit matches
it, ignoring case and a plural "s", so "1 bag" counts towards 100 bags.
Filing is shown each open step's done-when, its total and its tally so far,
and the start of what Dash prepared for it. When a step has no total and one
of those names the number ("all 100 bags"), the progress move may set it in
the entry's unit. It is never set over a total already there, and Undo on
that line clears it again unless it has been changed since. The filed line
then reads `Logged 2 bags on "…" in …, about 93 to go of roughly 100`.

Work the tree has no step for is added as a step that is already under way
(plan #1278). The add move takes the same text, amount, unit and day as the
progress move, and a total only when the sentence says how many in all.
Filing writes the step under the nearest one it fits and logs the entry on it
at once. With only a "Living room" step, "moved two bags to the office" adds
"Move the bags to the office" under it with 2 bags logged, and the filed line
reads `Added a step in …: "Move the bags to the office", 2 bags logged`. The
step and its entry share that one line, so one Undo archives the step and
marks the entry undone. A bad amount drops the entry and keeps the step.
Progress still goes on the goal itself when the work belongs to the goal as a
whole rather than to a piece of it.

A count can be several at once, on the day they happened (plan #1279). The
count move takes an amount, one when the sentence gives none, and a day read
as the progress move reads it. "Sent three applications yesterday" adds 3 to
the rhythm's period that yesterday falls in, which on a Monday is last week's,
already closed; that period is then marked kept or missed again from its new
count. A day before the rhythm's first period counts towards the current one.
The filed line reads `Counted 3 towards "Send applications" in …`, and Undo
takes the same 3 back from the same period. An amount that is not a whole
number from 1 to 100 drops the move.

The first entry on a step with no total asks once how far along it is (plan
#1280). Under its filed line, whether a progress line or an add that carries
work, the list shows "Roughly how far along?" with three chips: Just started,
About half and Nearly done. A tap keeps the answer on that entry and on the
line, and the chips go. The step's line then reads "Under way · about half
done", from the newest entry that carries an answer, until the step gets a
total, which says more and takes its place. The question is asked only on a
step's first entry, so it does not come back for that step whether it was
answered or left. A step that has a total, or gets one from that same line,
is not asked, and neither is progress on the goal itself.

The morning run reads the entries on the person's open steps (plan #1281). A
step under way with nothing logged for seven days is stalled, and the brief
lists it for a nudge: Dash names it in the home's note and the goal's, with
what is logged and the next piece to do. A step whose tally has reached its
estimated total, or that has no total and was last answered "Nearly done", is
listed for an offer to close it in the same notes. Dash never closes it on
the tally, since the total is an estimate; it closes only on evidence, as any
step of the person's. A step under way is left out of the list of steps
untouched for a week, so it gets the nudge rather than a split, a prep or a
question. The rules are in `lib/goals/progress-nudges.ts`.

## What Claude does, and when

Every automated job is a routine run. Runs count against the Claude plan's
usage and daily routine limits, and the dev plan and overnight runner draw on
the same allowance. So Goals runs on a schedule rather than on every change:

- **Daily, early morning.** While any goal is open, one run gives each open
  goal its status for the day (plan #1074): done-when met, on track,
  stalled, waiting on you, waiting on a date or waiting on another goal,
  with one sentence on why, the next move and its date. A met goal's reason
  is a summary of how it got there, and it is the proposal to close it
  ("Approval" above). A goal with nothing done in three weeks
  reads stalled, and its next move is added as a step (plan #1018). Before
  the verdicts, each step of yours untouched for a week gets a move (plan
  #1083, "Approval" above). The
  same run then works up to ten ready `claude` steps (`DAILY_STEP_LIMIT` in
  `lib/goals/daily-run.ts`) and the rest wait for the next morning. You open the app about once a day, so this
  is when the work has to be ready. The morning run does not map new or
  foggy goals; the night run does that.
- **Overnight.** While the overnight runner on `/dev/plan` is started, it
  maps each open goal that has no map yet or whose fog you changed, at most
  once a night, and then works ready `claude` steps one at a time between
  features. See "Claude's
  own work" below.
- **Weekly.** Research for each goal of the kinds of help it asks for:
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
  held up and adds anything new (plan #1017).

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

### A Dash step before yours

Runs also prepare your steps without being asked (plan #1207). When a goal
is mapped, re-shaped or given a new step of yours, the run judges each of
your steps once: if a draft, research, a shortlist or a list would help you
do it, and producing it is one sitting of Claude's work, a Claude step goes
in just before it with `prepares_id` naming your step. A cover letter comes
before an application and a shortlist of firms before a round of calls;
clearing the couch gets nothing. The prep step is not a dependency, so your
step never waits on it. Your step's `prep_checked_at` records that it was
judged, whether or not a prep step went in. A phase, a step already prepared
with **Prepare**, and a step whose Claude sibling already covers it get
none. A step you add on the page is judged by the next morning run, and the
morning run works the prep steps it added that same morning within its ten
steps. The rules and examples are in the goals skill, "A Dash step before
yours".

### From a comment

The `@dash` reply on a step (`lib/goals/ask.ts`) runs on Dash's shared loop,
with Ask Dash's lookups and writes. Beside answering, it can file facts as
drafts, date the step or put it on Todo, pass the comment to the goals
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
  an area), and steps that would act outside the plan. *Read*: a result Claude
  produced, and the context and drafts it found for a goal. *Do*: your own
  next steps across every goal, with the rhythms running out of days.
- **Dash is on it**: the runs going now, the Claude steps the next morning
  run will work, and the Claude steps held until you approve the goal they
  sit under or the action they would take.
- **Your goals**: each goal's bar, its status and the way into its
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
for the rest of that day: what Dash did while you were away (the list below),
what is waiting on you, and one next step per goal, with everything else
folded under it. The last visit is kept in `goals.visits`.

### Since your last visit

On any other day, the home opens with what Dash did since your last sitting
(plan #1076), newest run first, in three kinds of line:

- A result: the note or draft a run stored on a step. **Read** opens the step
  on its goal's page, where the result is shown and marked read. When the
  same run closed the step, the line has an **Undo** that puts the step back
  as it was and clears the result.
- A change to the map, worded as the run's own page words it ("Added step
  Call the servicer"), with **Undo**. It is the run page's undo (plan #1013),
  so a change undone in one place reads as undone in the other, and a change
  that has moved on since says why it stays.
- A run that failed, and why.

Changes are capped at ten, with the rest counted and left to each run's page;
results are never capped. A result you have not read from before this sitting
stays at the end of the list until you read it.

A sitting is page loads less than thirty minutes apart (`SITTING_MINUTES`
in `lib/goals/catch-up.ts`), and the list reads from the last visit before
this sitting (`goals.visits.previous_visit_at`). Reloading the home, or a
press on it, keeps the list and shows an undone line as undone; the next
sitting clears it. After time away that visit is the one before the gap, so
the catch-up shows the same list. The rules are in `lib/goals/done-since.ts`
and the reads in `lib/goals/done-since-store.ts`.

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

   Saving a read teaches the collection that kind of document
   (`goals.document_kinds`). The reader names the kind ("NSLDS loan
   export") and says how to recognise another one, and the save keeps, for
   each field, the label that filled it, the traps the reader warned of and
   any value you corrected, along with the suggestions you left out. The
   next read is given every kind the collection has learned. When the
   reader judges the document to be one of them, the preview says so, the
   read follows that kind's notes, and the fields you left out are not
   suggested again. A new kind is only written when the read taught
   something: a field added or left out, a trap, or a correction. The kinds
   are listed on the step, where you can rename one, edit its notes or
   forget it. Whether two documents are the same kind is the reader's
   judgement against the name and recognise line, rather than a fixed rule
   such as a header line or sender, because a pasted page has no sender and
   each issuer would need a rule of its own.
3. **Claude finds it first.** The goals routine has the Gmail connector. When
   it writes an information step it searches for what it can (loan
   statements, offer letters, receipts), fills in what it found as a draft,
   and names the email each value came from. You confirm it. It sets the
   step up from the questions the later steps need, then reads the first
   document it has (a file you gave it, a statement in Gmail) before settling
   the fields: an ID field on a list, each label checked against the row's
   status and dates, and what the document taught written as a kind on the
   collection. A file you give it is filed as drafts named after the file
   (plan #990).

   After that, new statements keep the rows current (plan #1023). A kind
   can name who sends it (`goals.document_kinds.senders`: an address, a
   domain or a name), written by Claude when it reads a statement from
   Gmail and editable on the step as "Who sends it". Each morning the run
   searches Gmail for new mail from those senders, reads each statement and
   matches it to rows by the ID field. As decided on #1022, a change goes
   straight in when the statement names a saved row by its ID and the
   change is ordinary: only dates changed, or tracked money values that
   moved by no more than a month's payment plus a month's interest on that
   row. The row is updated in place with source Gmail and the message
   linked, so its readings and any goal number worked out from the
   collection move with it, dated by the statement. Anything else waits as
   a draft. A draft carrying a saved row's ID shows "Update row", and
   confirming it puts its values on that row instead of adding a second
   one.
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
   `components/thread/thread.tsx`. The reply path needs a goals version
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
  `acceptance`, `fog`, `resolution`, `due_on`, `starts_on` (a step's first
  possible day, "Steps for later"), `on_todo`, `approved_at`,
  `acts` (on a Claude step, what working it does outside the plan),
  `merged_into` (on a step dropped as a duplicate, the step that carries its
  work; plan #1081), `evidence` with `evidence_source` (on a step of yours
  Claude closed, what it saw and where; plan #1082), `dropped_on` (on a step
  of yours dropped on your answer, the question you answered; plan #1083),
  `kept_open_at` (on a goal, when you last kept it open against a proposal
  to close or park it; plan #1084), `prepares_id` (on a Claude step, the
  step of yours it prepares, one live prep step per step and never a wait;
  plan #1215), `prep_checked_at` (on a step of yours, when a run judged
  whether it needs a prep step; plan #1215), `errand` (on a goal, that it
  is a one-off job with a date it is due by; an errand always has `due_on`,
  and a step is never one; plan #1261), `position`, and `rhythm_count` with
  `rhythm_period` for rhythms. A goal's status can also be `parked`. A goal's
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
- `goals.progress_entries`: partial progress on a step or goal, one row per
  report: `happened_on`, `text`, optional `quantity` with `unit`, optional
  `estimate` (`started`, `half` or `nearly`), the `capture_id` it was filed
  from, and `undone_at` once taken back (plan #1274). A step's
  `estimated_total` and `total_unit` on `goals.items` hold what the entries
  count towards; a goal's own number stays `unit`, `target` and readings.
- `goals.periods`: one row per rhythm per period, with target, count and
  whether it was kept.
- `goals.suggestions`: what Claude suggested, the kind of help it is, your
  reaction, and whether it happened.
- `goals.reviews`: each open goal's status, one row a day from the morning
  run: the verdict, why, the next move and its date (`next_on`), the step
  proposed for a stalled one, the goal a `waiting_on_goal` one waits on
  (`waits_on_id`), and the run that wrote it. A `met` verdict is the
  proposal to close the goal, with the summary as its reason. The newest row per goal is its
  status (`loadLatestReviews` in `lib/goals/reviews-store.ts`).
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

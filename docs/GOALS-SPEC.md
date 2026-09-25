# Goals

A workspace for the things you are working towards in your own life, run the
way `/dev/plan` runs the app: a tree of what has to happen, with Claude doing
the parts it can and your parts showing up as a short list of things to do.

> **Not built.** Worked out in conversation on 24 September 2026. Nothing here
> has a migration or a plan step yet; the build order at the end is the
> proposal for both.

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

**Areas** are directions that never finish: money, career, the city,
relationships, health. An area groups goals and has no done-when.

**Goals** sit under an area and have a done-when, even when it starts out
vague: pay off the debts, get a job, bench 200 lbs.

**Steps** sit under a goal, and a step can have sub-steps to any depth. Each
step is one of four kinds:

| Kind | Whose | Closes when |
|---|---|---|
| `mine` | yours | you say you did it |
| `claude` | Claude's | the thing it produced exists: a research note, a draft, a list of events |
| `decision` | yours | you answer the question on it |
| `rhythm` | yours | never; it is kept or missed, week by week |

Goals that are mostly yours, like making friends in New York, still get the
full tree. The map of what has to happen is useful even when Claude can do
none of it.

### Rhythms

Some goals end and some are practices. "Get a job" ends. "Make friends in New
York" and "get plugged into city life" are practices, and they are served by a
rhythm such as *one city event a week* or *reach out to someone every few
days*. A rhythm has a target count per period, and progress on it is whether
the recent periods were kept. It never shows as done.

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

- **Daily, early morning.** Work ready `claude` steps, shape newly added or
  foggy goals, and write the day's view. You open the app about once a day, so
  this is when the work has to be ready.
- **Weekly.** A verdict on each open goal against its done-when: on track,
  stalled or waiting on you, with one sentence on why and the next move,
  shown on the goal's card on the Goals home. A goal with nothing done in
  three weeks reads stalled, and its next move is proposed as a step
  (plan #1018). Then research for each goal of the kinds of help it asks for:
  events, volunteer openings, reading, courses or job leads (plan #1028).
  Each suggestion carries its kind and has quick **going / not for me**
  buttons, and the next week's research for a kind reads the reactions to
  that kind. Sources such as Eventbrite,
  Meetup and org newsletters vary in how reachable and current they are, so
  the first few weeks will be uneven and should improve with the feedback.
- **On request.** A **Work on this** button on a goal fires one run for it.
- **After an answer.** Answering a question on a goal fires one run for that
  goal once ten minutes pass with no further answer, so several answers in
  one sitting cost one run. It settles the provisional steps the answers
  held up and proposes anything new (plan #1017).

## The daily view

The Goals home page is for a once-a-day visit. It shows:

- For each active goal, the next one to three things, with yours first.
- Anything waiting on you: an unanswered decision, a proposed breakdown to
  approve, a finished draft to review.
- Rhythms at risk this period.

The full tree for a goal is one tap away and is for when you want to look at
the map, usually on a laptop. It is not the default because a tree of eighty
steps is too much to read every morning.

### Coming back after time away

After a gap, missed items collapse rather than pile up. Overdue `mine` steps
move back to *next* without an overdue badge, missed rhythm periods show as a
single line ("3 weeks missed"), and the page leads with what matters now. The
point is that opening the app after a busy fortnight should not feel like a
debt.

## Your examples, broken down

These are the first goals to enter once it exists, and a check on whether the
model fits them.

**Pay off the debts** (Money). You give balances, rates and minimum payments
once. Claude builds the payoff order and monthly targets. After that it asks
for one number a month, the new balances. There is no bank connection.

**Get a job** (Career). Sits over the Jobs module. Claude finds roles and
drafts applications as `claude` steps; you apply and interview. Progress is
counted from Jobs.

**Get plugged into city life in NYC** (The city). A rhythm of one event a week,
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
- **An ID field.** One text or number field of a list can be marked
  `"id": true`, such as a loan's ID. Reading a newer statement then updates
  the row with the same ID instead of adding a copy, and the preview shows
  the saved value beside each one it would change.
- **Changing a definition** raises its version. Existing records keep their
  values; a new field shows empty; a removed field is hidden but its values
  stay in the record.

An information step closes when its collection has what the step asked for.
Later steps and runs read the collection instead of asking again.

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

- `goals.areas`: id, user_id, name, position.
- `goals.items`: the tree. One table for goals and steps, as `plan_items` is
  one table for features and steps. `area_id` on top-level rows, `parent_id`
  below them, `level` (`goal` or `step`), `kind`, `status`, `title`, `detail`,
  `acceptance`, `fog`, `resolution`, `due_on`, `on_todo`, `approved_at`,
  `position`, and `rhythm_count` with `rhythm_period` for rhythms. A goal's
  `help_kinds` lists the weekly help it asks for, each an entry of `kind`
  (events, volunteering, reading, courses or job_leads) and a `note` on what
  to look for (plan #1027).
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
- `goals.dependencies`: one row per step that cannot start until another
  step closes, with the loop and same-account checks `plan_dependencies` has
  (plan #981). `goals.items` carries `block_ask` and `block_kind` for a
  blocked step.
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

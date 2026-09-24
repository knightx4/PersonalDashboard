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
- **Weekly.** Research for rhythm goals: the NYC city events list, volunteer
  openings, talks. Each item has quick **going / not for me** buttons, and that
  feedback is what the next week's research reads. Sources such as Eventbrite,
  Meetup and org newsletters vary in how reachable and current they are, so
  the first few weeks will be uneven and should improve with the feedback.
- **On request.** A **Work on this** button on a goal fires one run for it.

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
  `position`, and `rhythm_count` with `rhythm_period` for rhythms.
- `goals.item_goals`: extra goals a step counts towards, beyond its own
  parent.
- `goals.links`: a goal or step to a Learn aim, a job application, a role.
- `goals.log`: what capture filed and what rhythms counted, one row per
  event, with a reference to the capture it came from so **Undo** can reverse
  it.
- `goals.runs`: one row per routine run, as `plan_runs` does for the dev plan.

Its own schema, as `job_search` and `todo` have theirs, with row level security
on every table. Reusing `plan_items` itself was considered and rejected: its
kinds, commit column and routine assumptions are about building software, and
mixing personal goals into the dev plan's tables would put them on `/dev`
surfaces that other signed-in accounts cannot see and should not.

## Build order

Each is roughly one plan step.

1. Schema and module registration: `goals` in `lib/modules.ts`, the tables
   above, and an empty Goals home.
2. Areas and goals: add, edit, reorder; fog on a goal.
3. The step tree with sub-steps, the four kinds, and the full-tree view.
4. The daily view, with the next items per goal and what is waiting on you.
5. Show on Todo: the flag, the agenda source, ticking closes the step.
6. Rhythms: period counting, the at-risk line, the Todo item per period.
7. Capture: the fast filing call, the filed list with Undo.
8. Links to Learn aims and Jobs, and progress read from them.
9. The goals routine and its skill: shaping, working `claude` steps, approval
   once per goal.
10. Weekly research for rhythm goals, with going / not for me feedback.
11. Coming back after time away.

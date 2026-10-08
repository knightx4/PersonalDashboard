# Planning an area

Part of the goals skill. Read [../SKILL.md](../SKILL.md) first: it has how
every write is labelled, the run row, what you may change, and the index
saying which file holds each section named here.

The person pressed **Plan this area** on an area, or **Plan what is missing**
on one that already has goals. They know the direction ("get plugged into
the city") and not the goals that would get them there. Your job is those
goals: a short set of proposals they can approve or turn down one by one, each
concrete enough that **Ask Dash** can map it afterwards.

The brief names the area, what the person wrote they want from it (the
area's `note`, which may be empty), the goals already under it, and the run
row, whose `job` is `area` and whose `area_id` is the area. Report progress on
it as for any run.

### Reading the area

Before proposing, look in the other modules as "Pulling in from the other
modules" says, for what the person has written about the area as a whole:
their vault notes on it, their job search thoughts for a career area. Goals
they have already described in their own words come first among your
proposals, in their words. Write what you found as context on the goals you
propose it for.

```sql
select id, name, note from goals.areas
where id = '<area id>' and user_id = '<user>';

-- every goal the area has had, including the ones turned down
select id, title, acceptance, fog, detail, status, archived_at
from goals.items
where area_id = '<area id>' and user_id = '<user>' and level = 'goal';

-- the other areas' goals, so nothing is proposed twice
select a.name, i.title, i.status
from goals.items i join goals.areas a on a.id = i.area_id
where i.user_id = '<user>' and i.level = 'goal' and i.archived_at is null
  and i.area_id <> '<area id>';

-- what the person did with past suggestions, which says what they go to
select kind, title, reaction, attended from goals.suggestions
where user_id = '<user>' order by created_at desc limit 100;
```

A goal with `archived_at` set or `status = 'dropped'` was turned down. Do not
propose it again, in the same words or others. A goal of theirs that already
covers a direction means you leave that direction alone.

### What to propose

0. **Check the three levels first** (spec, "The three levels"). An area is
   a direction; a goal is an outcome that ends; a practice is never a goal.
   - **A practice goes inside a goal as a `rhythm` step**, never as a goal.
     "Go to one event a week" is the way to "Know ten people in the scene by
     name", so propose the second and put the first inside it. The database
     refuses a goal from you whose title or done-when reads as a rate or a
     streak (`goals.reads_as_practice`, migrations-goals/0041).
   - **Parts that serve one done-when are stages of one goal**, not several
     goals, whether they follow one another or run side by side. Knowing the target, a résumé, a network,
     applying, interviewing and negotiating all serve getting the job: that
     is one goal, *Land your next role*, with six stages. Propose several
     goals only for outcomes that stand on their own.
   - **An area whose name is itself an outcome** ("Get a job") gets one goal
     with stages, and the run summary says the area would read better named
     as a direction ("Career"). The name is the person's to change.
1. **Three to six goals**, fewer when the area already has some. Together
   they should cover the main ways into the area, so the person can see the
   whole shape of it and pick. For a scene or a community that usually means
   some mix of: knowing the subject, showing up, knowing people, joining
   something, and contributing something of their own. For money or health it
   means the separate outcomes (the debt, the fund, the habit).
2. **Each one a goal, not a step.** It takes weeks or months and has several
   steps under it. "Go to a community board meeting" is a step; "Be a regular
   at your community board" is a goal.
3. **A title that says what will be true**, in under about eight words, and
   an `acceptance` that can be checked: a count, a date, a thing that exists.
   "Know ten people working on housing or transit by name" rather than "build
   a network". Never a rate or a streak: that is a practice, and it goes
   inside the goal as a `rhythm` step.
4. **A `detail` of one or two sentences**: why this goal serves the area, and
   what it assumes about the person. That sentence is what they decide on.
5. **One first move under each**, as a proposed step with its own
   `acceptance`: the smallest thing that would start the goal this week. Only
   one. The full map comes from **Ask Dash** once they approve the goal,
   so do not map it here.
6. **`position` in the order to start them**, in tens after the area's
   existing goals. Put the goal that is easiest to start, and that makes the
   others easier, first.

Use the person's note as the brief. Where it is empty, or the area could mean
quite different things (a career in urbanism, or a civic life in the city),
propose goals covering the likely readings and say in each `detail` which
reading it serves. Turning down the ones that do not fit is how the person
answers. Settle what shape each goal takes yourself, as "Decide first, ask
last" says, and name the choice in its `detail`; a question under a goal
passes that test or is not asked. Where you cannot write a goal's done-when
even provisionally, write it with `fog` instead.

Use web search where current facts make a goal concrete: the organisations,
groups, meetings and publications that exist in the person's city for this
area. Name them in the `detail` or the first move ("Join Open Plans' volunteer
list"), not in the title.

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
with g as (
  insert into goals.items (user_id, level, area_id, title, acceptance, detail, status, position)
  values ('<user>', 'goal', '<area id>',
          'Be a regular at your community board',
          'You have attended six full board or committee meetings and spoken at one.',
          'Community boards are where land use and street changes are argued first, and the same people come every month. Assumes you live in one board''s district.',
          'proposed', 10)
  returning id
)
insert into goals.items (user_id, level, parent_id, kind, title, acceptance, status, position)
select '<user>', 'step', id, 'mine',
       'Go to this month''s land use committee meeting',
       'You attended and wrote down two things that were argued.',
       'proposed', 10
from g
returning id;
```

### A worked shape: Get plugged into the city / urbanism scene

1. **Know how the city's planning fights work**: done when you can explain
   ULURP, the zoning text amendments of the last two years and one open fight
   in your borough. First move: a `claude` step for a two-page primer with
   the reading list, and a link to Learn where a course fits better.
2. **Know ten people in the scene by name**: done when ten people working on
   housing, transit or planning would recognise you. Inside it, a `rhythm`
   of one urbanism event a week, which the weekly run feeds with events; the
   events are the way there, not the goal. First move: yours, write down the
   three you already know.
3. **Be a regular at your community board**: as in the example above.
4. **Volunteer steadily with one advocacy group**: done when you have put in
   ten sessions with one of Open Plans, Transportation Alternatives, Open New
   York or the like. First move: a `claude` step comparing three groups'
   volunteer asks.
5. **Put something of your own into the conversation**: a testimony, an
   op-ed, a map or a talk, published or given. Unless the person has said
   what they would want to make, start with testimony at the community board
   (goal 3 already puts them in the room) and say so in the `detail`; do not
   ask them to choose a format.

### Afterwards

Change nothing on the area itself: its name and note are the person's. Do not
edit, drop or archive a goal of theirs. The summary lists each goal proposed
with its first move, each decision made for the person, any question asked,
and which directions you left alone
because an existing goal covers them. The person approves each goal on its own
page, and **Ask Dash** there maps it.

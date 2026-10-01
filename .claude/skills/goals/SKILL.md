---
name: goals
description: Work the person's life goals in the goals schema — the tree of areas, goals and steps on /goals. Pulling in - before mapping, search the other modules through the catalogue (job search thoughts, vault notes, Learn aims, applications) and keep what bears on the goal as context. Planning an area - propose the goals an area needs when the person knows the direction but not the goals, each with a done-when and a first move. Mapping - lay out the whole path for a goal from the first run: phases with sub-steps, Claude steps wherever Claude can do the work, information steps that start from the questions later steps need, with a collection built from the first document and pre-filled as drafts, choices made with judgement and written on the steps they shape, a question with lettered options only for what Claude cannot settle itself, provisional steps for what hangs on one, and the kinds of weekly help that fit the goal as a proposal on its page. Re-shaping - read the answers to those questions and settle the provisional steps. Under an approved goal (every goal the person added is one), add, split and reorder steps without asking; only a step that acts outside the plan (sending an email, submitting, buying, changing records elsewhere) goes in as a proposal for them to approve. Morning run - read new statements from Gmail into their collections by ID (ordinary changes straight in, the rest as drafts), close each step of the person's it can see has happened (in Jobs, Gmail, the calendar or Todo) with a note naming the evidence, give each step of theirs untouched for a week a move (split it, prepare it, or ask whether they still want it), then give each open goal its status for the day (on track, stalled, waiting on you, waiting on a date or waiting on another goal) with the next move and its date, adding that move as a step for a stalled goal, then work the ready Claude steps and store what each produced on the step. Weekly run - research the help each goal asks for (events, volunteer openings, reading, courses, job leads) and write it as suggestions tagged with their kind, following past reactions to each kind, and leave a note on every open goal. Flagging - put what a run finds that the person should know (a moved due date, a missed payment) under Waiting on you on the goal, and act on their answer. Use when the goals routine is fired from "Plan this area" on an area, from "Work on this" on a goal, by the morning run or by the weekly run, or the user says "plan my <area> area", "what goals should I have for …", "shape my goal …", "break down <goal>", "work on my goals".
---

# Working a goal

Goals is the person's own workspace at `/goals`: areas (money, career, the
city), goals under them, and a tree of steps under each goal. The spec is
`docs/GOALS-SPEC.md`; read "The three levels", "Fog and refining a goal",
"Approval" and "Second round: making it useful" before your first write.

Your part is the map: the whole path from where the person is to the goal's
done-when, with every step on it that you can see. You do the steps you can
do, you gather the facts you can find, and you make the choices you can make
with judgement, so the person's part is doing the steps. Ask a question only
when you cannot settle it yourself (see "Decide first, ask last").

## How you read and write

Through the **Supabase** connector (`mcp__Supabase__execute_sql`, loaded with
ToolSearch), project `asjztutnqxbecruvyrbj`. Every table is in the `goals`
schema except files, which are in `core` (see "Files"). Filter every read and
write by the `user_id` in your brief.

**Every write declares who and which run, in the same call:**

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
insert into goals.items (...) values (...) returning id;
```

The two settings last only for that one `execute_sql` call, so they go at the
top of every call that writes. The history trigger reads them to record the
change as yours and tie it to the run. A guard on `goals.items` reads the same
setting and refuses the writes described under "What you may change"; a
refusal is the rule working, so read the message and do what it says instead
of looking for another way round.

To the person you are **Dash**. Anything they will read (a step's result, a
file, a note, a reply, a flag, a verdict) says "Dash" or "I", never "Claude".

Never write `closed_at` (a trigger keeps it), `goals.history` (triggers write
it), `approved_at`, `reviewed_at`, a question's `resolution`, `dismissed_at`
or `fog_dismissed_at`, and never set a record's `draft` to false.

## The run row

Every run has a `goals.runs` row.

- Fired from **Plan this area** (job `area`, with `area_id` on the area and
  no `item_id`), from **Work on this**, by the **morning run**, by the weekly run,
  after the person answered questions on a goal (job `reshape`), or by
  **Send** on one step or phase (job `step` or `phase`), or by **Prepare** on
  one step of the person's (job `prepare`), or by the person answering
  something you flagged on a goal (job `raise`): the app has written the row as
  `started`, and its id is in your brief. Use it.
- Started any other way: write one first, with `job` `goal` and `item_id` for
  one goal, or `daily` / `weekly` for a scheduled run, and use its id.

  ```sql
  insert into goals.runs (user_id, job, item_id, status)
  values ('<user>', 'goal', '<goal id>', 'started') returning id;
  ```

Close it before you stop, with a short plain summary of what changed: how many
steps you proposed or added, which questions you asked, what you dropped.

```sql
update goals.runs set status = 'done', summary = '…', ended_at = now()
where id = '<run id>' and user_id = '<user>';
-- or, when the run could not do its job
update goals.runs set status = 'failed', error = '<why>', ended_at = now()
where id = '<run id>' and user_id = '<user>';
```

### Reporting progress

While the run is going, report at each step you start: which one, and that
you are still there. The goal page and the Runs page show it as "on Draft the
letter, 3 minutes ago".

```sql
update goals.runs set last_seen_at = now(), now_on = '<the step title, or what you are doing>'
where id = '<run id>' and user_id = '<user>' and status = 'started';
```

Report when you start mapping a goal, at each step of a morning run, at each
step of a phase, and at least every 15 minutes during anything long, such as
reading a long Gmail thread or researching one step. `now_on` is a short
line, up to 300 characters; the step's title is usually right.

A run with no report for 45 minutes is taken to have died. A sweep every few
minutes closes it as failed, and the person can press **Work on this** or
**Send** again. If you find your run row already closed as failed, stop
working: say so in your last message and do not write to it again.

## Reading the goal

```sql
select id, area_id, title, detail, acceptance, fog, fog_dismissed_at, status,
       approved_at, unit, target
from goals.items
where id = '<goal id>' and user_id = '<user>' and level = 'goal' and archived_at is null;

with recursive tree as (
  select i.*, 0 as depth from goals.items i
  where i.parent_id = '<goal id>' and i.archived_at is null
  union all
  select c.*, t.depth + 1 from goals.items c
  join tree t on c.parent_id = t.id
  where c.archived_at is null
)
select id, parent_id, depth, kind, status, title, detail, acceptance, resolution,
       dismissed_at, collection_id, asks_for, questions, position, due_on, starts_on, rhythm_count,
       rhythm_period, block_ask, block_kind
from tree order by depth, position;

-- what the steps wait on: each row is "item cannot start until depends_on closes"
select d.id, d.item_id, d.depends_on_id, p.title, p.status
from goals.dependencies d join goals.items p on p.id = d.depends_on_id
where d.user_id = '<user>';

-- the collections this goal already has, and every live one on the account
select c.id, c.name, c.shape, c.fields, c.version,
       exists (select 1 from goals.collection_goals g
               where g.collection_id = c.id and g.goal_id = '<goal id>'
                 and g.archived_at is null) as serves_this_goal,
       (select count(*) from goals.records r
        where r.collection_id = c.id and r.archived_at is null) as records
from goals.collections c
where c.user_id = '<user>' and c.archived_at is null;
```

Also worth a look where they exist: the area's other goals (so you do not
propose a duplicate), `goals.readings` for a measured goal, `goals.links` for a
goal tied to Learn or the job search, the files the goal and its steps link to
(`goals.links` with `kind` `file`, then `core.files`; read them before redoing
work an earlier run already wrote up), the newest note on the goal
(`goals.briefs`), the comments on the goal and its steps
(`goals.comments`), and the recent `goals.history` rows for this goal's steps.
A step the person dropped or archived tells you what they did not want. Do not
propose it again.

Two things the person has put aside stay put aside:

- **A question with `dismissed_at` set** was put aside with Not now. It is
  still unanswered: build on it as provisional, as for any open question, and
  do not ask it again in other words. Never write `dismissed_at`.
- **Fog with `fog_dismissed_at` set** was put aside. Do not raise the same
  point again as fog or as a question. Rewriting the goal's fog to say
  something new brings it back, which is allowed when there is something new
  to say. Never write `fog_dismissed_at`.

## Pulling in from the other modules

The person keeps more of their life in the app than in Goals: what they want
from the next job in the job search's thoughts, notes in their vault, aims in
Learn, applications, tasks. A map that ignores those asks them questions
they have already answered in writing. So before you map a goal or plan an
area, look for what the other modules already hold about it.

### Where to look

[reference/sources.md](reference/sources.md) is the catalogue: every table
that can bear on a goal, what it holds, which columns to search, how to name
and link a row, and where it opens. It is written from each module's own
`sources.ts` and the gate keeps it complete, so a table that is not in it is
either new since this checkout or not about the person's life.

Choose the sources by what they hold and what the goal is about, not by the
module's name. A career goal reads the job search, but also vault notes on
work, Learn aims on the skills it needs, and a money goal's savings target
if the move means a pay cut. A goal about the city might read vault notes,
saved news stories and calendar events. Read in the catalogue's order:

1. **What they said they want** (`intent`). Read all of it that bears on the
   goal. These are the person's own words about what they want; quote them
   rather than paraphrase, and let a newer entry win over an older one.
2. **What they did or have** (`record`). Read for progress and for facts to
   fill the goal's collections.
3. **Mentions** (`incidental`). Leads only, never evidence of what they want.

### How to search

Every read is scoped to the person: `user_id = '<user>'` unless the catalogue
names another way. Search the columns it lists with the goal's words and
their near neighbours ("job", "career", "role", "work", the field's name):

```sql
select id, left(body, 400) as body, created_at
from job_search.thoughts
where user_id = '<user>'
order by created_at desc;

select id, title from job_search.roles
where user_id = '<user>'
  and (title ilike '%planner%' or jd_text ilike '%urban%');
```

The vault is the largest source, so search it two ways:

```sql
-- by meaning: read the theme list whole and pick the themes that bear on the goal
select id, name, about from obsidian.themes where user_id = '<user>' order by name;

-- then the notes under them, by name only: a theme can hold hundreds
select n.path, n.title, n.updated_at
from obsidian.theme_notes tn
join obsidian.notes n on n.id = tn.note_id and n.deleted_at is null
where tn.theme_id = any('{<theme ids>}'::uuid[]) and tn.user_id = '<user>'
order by n.updated_at desc;

-- by words: full text over every note
select path, title, ts_headline('english', body, q) as hit
from obsidian.notes, websearch_to_tsquery('english', 'job OR career OR "looking for"') q
where user_id = '<user>' and deleted_at is null and search_tsv @@ q
order by ts_rank(search_tsv, q) desc limit 20;
```

Searching is cheap; reading is what costs. The vault is about 1,300 notes
and well over a million words, far more than a run can read, so narrow
first and read last:

1. Search by name and by full text, which return paths, titles and a
   highlighted line, not bodies.
2. From those, choose the notes that plainly bear on the goal: usually five
   to fifteen, never more than about twenty-five in a run.
3. Read only those in full, and rely on nothing you have not read in full.

A run with kept context on the goal starts from those rows and reads their
notes again, and searches only for what has changed since
(`updated_at > <the last run on the goal>`). Report progress on the run row
while you search ("Reading the vault for job notes").

### What is already on the goal

```sql
select source, ref, title, status from goals.context
where item_id = '<goal id>' and user_id = '<user>';
```

**Kept** rows are where to start: read them again first, since they may have
changed. **Dismissed** rows were turned down: never propose the same
`source` and `ref` again. **Proposed** rows wait on the person; leave them.

### Writing what you found

Write a `goals.context` row for each thing that changes the map, the
done-when or the questions, and only those: a handful, rarely more than
eight. A note that only mentions the subject is not context.

- `source` is the table as the catalogue names it, `ref` the row by the
  column the catalogue says to link it by (a vault note's `path`).
- `title` is the row's name as the catalogue says to take it.
- `why` is one sentence on how it bears on this goal: "Says you want a
  planning role with fieldwork, not a desk job."
- `excerpt` is the words that matter, quoted exactly, a few sentences at
  most. Never copy a whole note.
- `status` is `proposed` on a goal that is not approved; on an approved one
  you may write it `kept`.

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
insert into goals.context (user_id, item_id, source, ref, title, why, excerpt, status, run_id)
values ('<user>', '<goal id>', 'obsidian.notes', 'Career/What I want next.md',
        'What I want next',
        'Lists what you want from the next role: fieldwork, a public-sector employer, under an hour''s commute.',
        'I want to be out in neighbourhoods at least two days a week. Public sector over consulting.',
        'proposed', '<the run id>')
on conflict (item_id, source, ref) do nothing;
```

The database refuses a dismissed row from you, a change to one the person
dismissed, and keeping a proposal on a goal that is not approved.

### Using it

What you found should show in the map, or it was not worth writing:

- **Steps and done-whens follow it.** A step that says "Shortlist roles with
  fieldwork and a public-sector employer" rather than "Shortlist roles".
- **Do not ask what is already written.** If a thought or a note answers a
  question you would have asked, build on the answer and cite it in the
  step's `detail` instead. Ask only when sources disagree or are silent.
- **Facts fill collections as drafts**, the way Gmail does: `source = 'app'`
  and `source_ref` the row as `schema.table:ref`
  (`job_search.thoughts:<id>`). The page links the draft back to it.
- **Progress is read, not copied.** Where a goal is measured by something a
  module counts (applications, readings), link it with `goals.links` where
  the kind exists, and say how it is counted rather than logging a number.

### Something the catalogue does not list

If a table outside the catalogue plainly holds something about the goal
(read table and column comments with `obj_description` and
`col_description` to find out what a table is for), you may use it, and the
run summary must name it: "Found your career notes in
`job_search.profiles.summary`, which is not in the catalogue." That line is
how the catalogue gets fixed.

## Mapping a goal

"Work on this" asks for the whole map, on the first run and on every run
after. Lay out the full path from where the person is to the goal's
`acceptance`, and mark what is not settled yet. Do not stop at the first
question: a question is one step on the map, and the steps after it are
written anyway.

A goal is **not approved** while `approved_at` is null, which in practice
means a goal you proposed that the person has not taken yet: a goal they add
is approved as they add it (`migrations-goals/0042`). Everything you write
under an unapproved goal goes in `proposed`, except a question, which goes in
`open`. Under an approved goal, what you write goes in `open`, provisional
steps included (below). The one exception is a step that acts outside the
plan, which always goes in `proposed` ("Steps that act outside the plan"). Before you add anything, read what is already
there and build around it: keep the person's steps, fill in what is missing,
and reuse a step that already says what you were about to write.

### Stages and sub-steps

1. **Stages at the top level.** (Older runs, and the Send a phase job, call
   them phases; they are the same thing.) Three to six steps under the goal, in the
   order they roughly happen, each a stage of the path: for a debt goal, get the
   numbers, choose the order, build the schedule, set up the payments, keep it
   on track. Stage order is not a gate: the morning run works ready steps in
   every stage, and the goal page opens every stage under way. When a stage
   genuinely cannot start before another is done (applications wait on the
   résumé), add a dependency from its first steps to the step they need
   ("Blocked and waiting steps"); the page then reads that stage as waiting on
   the other. Leave stages that can run side by side without one (networking
   alongside the résumé). A phase has `kind = 'mine'`, an `acceptance` saying what is true
   when the stage is over, and sub-steps. It reads Waiting while its sub-steps
   are open, and closes itself once they are all done or dropped (a trigger,
   `migrations-goals/0040`); never close a phase yourself. A merge is the
   exception to both halves: see "Merging duplicate steps".
2. **Sub-steps under each phase.** Two to five, each one sitting of work, each
   with its own `acceptance`. A sub-step bigger than one sitting gets
   sub-steps of its own.
3. **`position` in tens** (10, 20, 30) at every level, so the person's own
   steps can go between yours.

Every step has a `kind`:

- `claude` wherever you can do the work: research, a comparison, a
  calculation, a schedule, a draft letter or email, a checklist. **Make it a
  `claude` step whenever you could produce it without the person's hands.** A
  map with every step marked `mine` hands the person work you could have done.
  The morning run works an open `claude` step once nothing beneath it is open.
- `mine` for what only the person can do: log in, call, sign, pay, decide
  something that is not a question you can put to them.
- `rhythm` for a practice, with `rhythm_count` (1 to 100) and `rhythm_period`
  (`day`, `week` or `month`): log the balance monthly, review every quarter.
- `decision` for a question (below).

For every `mine` step you write, and every open one already on the goal that
no run has judged (`prep_checked_at` is null), decide whether a Dash step
just before it would help, and add it or mark the step as needing nothing:
see "A Dash step before yours".

### Information steps

A step that needs facts from the person (balances, rates, dates, account
names) is an information step: it points at a **collection**, and the page
draws a form or a table from the collection's fields. "List your loan
balances" with nowhere to list them is the gap these close.

Set one up in this order: the questions, then the sources, then the fields.
A form settled before anyone has read a document leaves out what the
document holds, and a field named from memory can mean something different
in the document that fills it. The examples below are student loans, but the
order is the same for any goal and any kind of document: a pay stub for a
budget, a lease for a move, a benefits summary for a job offer, a lab report
for a health goal.

1. **Write the questions first.** Read the later steps on the map and ask
   what each needs to know from this one. A payoff schedule needs the date
   the first payment falls due and what the payments come to a month; a move
   needs the date the lease ends and how much notice it asks for. Each
   becomes a question on the step (point 6). A field belongs on the form when
   a question needs it, when it names the row (the ID, point 5), or when it
   says what state the row is in; leave out the rest.
2. **Reuse before you define.** Read the account's collections (the query
   above). If one already holds these facts, use it: serve it to this goal
   and, if it lacks a field you need, add the field. Make a new collection
   only when none fits. Names are one per account, case-insensitive, so
   "loans" means one thing.
3. **Read a source before settling the fields.** Look for a document that
   holds the facts, and read all of it before you write the definition:
   - a file the person gave you in this conversation, or one the brief or a
     comment on the step names;
   - the collection's records and the kinds of document it has already
     learned (`goals.document_kinds`, point 7);
   - a statement, notice or export in Gmail, searched for as "Pre-filling
     from Gmail" says (search now, and write the drafts once the collection
     exists);
   - the context kept for the goal ("Pulling in from the other modules").

   Build the fields from what the document holds: each label that answers a
   question, the label that names each row, and the status and dates that
   say what state each row is in. The date the figures are as of goes in the
   record's `as_of`, not a field. When no document exists yet, define the
   fields from the questions alone; the first document the person reads into
   the form on the step suggests the fields it has and the form lacks.
4. **Never trust a field name without checking it.** Before a label fills a
   field, check what it says against the row's status and its other dates.
   A start date that falls before the status began, or a due date on a row
   whose status says nothing is due yet, means the label names something
   else. In an NSLDS loan export, "Repayment Begin Date" on a Grad PLUS loan
   is the date of its last disbursement: the loan's status is still in
   school or in grace, and the first payment is the next due date. Name the
   field for what it holds, not for the label, and write what you found in
   the kind's field notes (point 7) so the in-app reader avoids the same
   trap. Where you cannot settle what a label means, leave the value out and
   say so in the run summary.
5. **Define it from the field types.** You never write a table or a
   migration; a collection is a row. `shape` is `list` for one row per thing
   (loans, accounts) and `one` for a single set of facts (a budget, a
   profile). Each field is `{"key", "label", "type"}` with, where it applies,
   `"tracked": true`, `"id": true` or `"options": [...]`:

   | type | stores | use for |
   |---|---|---|
   | `text` | one line, up to 500 characters | a name, a servicer |
   | `long_text` | up to 20,000 characters | notes |
   | `number` | a number | a count |
   | `money` | a number to the cent, `1234.56` | a balance, a payment |
   | `percent` | `6.8` for 6.8% | an interest rate |
   | `date` | `"YYYY-MM-DD"` | a payoff date |
   | `day_of_month` | a whole number, 1 to 31 | a due day |
   | `yes_no` | `true` or `false` | on autopay or not |
   | `choice` | one of `options`, exactly | federal or private |
   | `link` | an http or https address | the servicer's login page |

   `key` is lower case letters, digits and `_`, at most 40 characters, and
   never changes. `tracked` goes only on `number`, `money` or `percent`, and
   makes every change to that value a dated reading, so a balance becomes a
   chart: mark the numbers the goal is measured by. A field is never taken
   out of the array; set `"removed": true` to hide one. Its type never
   changes; add a new field instead. The database refuses a definition that
   breaks any of this and names the field.

   **Mark the ID field on a list.** One `text` or `number` field carries
   `"id": true`: the value the documents use to name each row, such as a
   loan ID, an account number or a policy number (the last four digits when
   that is all a document gives). Reading a newer document then updates the
   row with the same ID instead of adding a copy. A list has at most one ID
   field; a `one` collection needs none. An existing list without one gets
   it as an added field.
6. **Serve it to the goal and point the step at it.** `asks_for` lists the
   field keys the step needs; leave it null when it needs every field.
   `questions` lists the questions from point 1, in order, as
   `[{"key": "first_payment", "question": "When does my first payment fall
   due?"}]`: keys are lower case, digits and `_`, unique on the step, and
   they are the keys the answers carry (see "Answers on an information
   step"). Write at least one. The step closes itself once every question
   has a current answer with sources, not when the fields are filled.

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
with c as (
  insert into goals.collections (user_id, name, shape, fields)
  values ('<user>', 'loans', 'list', '[
    {"key": "loan_id", "label": "Loan ID", "type": "text", "id": true},
    {"key": "name", "label": "Loan", "type": "text"},
    {"key": "servicer", "label": "Servicer", "type": "text"},
    {"key": "status", "label": "Status", "type": "choice", "options": ["In school", "Grace period", "Repayment", "Deferred", "Forbearance", "Paid off"]},
    {"key": "balance", "label": "Balance", "type": "money", "tracked": true},
    {"key": "rate", "label": "Interest rate", "type": "percent"},
    {"key": "next_due", "label": "Next payment due", "type": "date"},
    {"key": "minimum", "label": "Minimum payment", "type": "money"}
  ]'::jsonb)
  returning id
), served as (
  insert into goals.collection_goals (user_id, collection_id, goal_id)
  select '<user>', id, '<goal id>' from c
)
insert into goals.items (user_id, level, parent_id, kind, title, acceptance,
                         collection_id, asks_for, questions, status, position)
select '<user>', 'step', '<phase id>', 'mine',
       'Know when loan payments start and what they total',
       'Both questions have an answer that names the loans it was worked out from.',
       id, null,
       '[{"key": "first_payment", "question": "When does my first payment fall due?"},
         {"key": "monthly_total", "question": "What is the monthly total?"}]'::jsonb,
       'open', 10
from c
returning id, collection_id;
```

An existing step that already asks for these facts (say "List your loan
balances, rates and minimum payments") is pointed at the collection with an
update of `collection_id`, `asks_for` and `questions`, rather than written
again.

7. **Write down what the document taught.** When you built or extended the
   form from a document, write the kind of document it was to
   `goals.document_kinds`, the same row the step writes when the person
   saves a read (plan #987). The next document of that kind read on the step
   is then recognised and filled in without suggestions:

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
insert into goals.document_kinds (user_id, collection_id, name, recognise,
                                  field_notes, skipped, last_read_at)
values ('<user>', '<collection id>', 'NSLDS loan export',
        'A text export from studentaid.gov headed "File Request Date", one block per loan.',
        '{"next_due": "Filled from \"Next Payment Due Date\". Trap: \"Repayment Begin Date\": for Grad PLUS loans this is the last disbursement date; the first payment falls on the Next Payment Due Date."}'::jsonb,
        '[]'::jsonb, now())
returning id;
```

   - `name` is what a person would call the kind, up to 120 characters,
     one per name among the collection's live kinds. If the collection has a
     kind of this name already, update that row instead: keep the notes as
     they stand, since the person may have edited them, and add yours after.
   - `recognise` says how to tell another document is of this kind: its
     title or header line, who issues it, its layout. Never the person's own
     values.
   - `field_notes` has one note per field the document filled, keyed by the
     field: `Filled from "<label>".`, and for a label that means something
     other than it says, `Trap: "<label>": <what it holds, and where the
     value is instead>.` This is where a field meaning you checked in point 4
     goes. The wording matches what the app writes
     (`learnKind` in `lib/goals/document-kinds.ts`).
   - `skipped` lists the labels you chose to leave off the form, so the
     reader does not suggest them again.
   - `senders` lists who sends documents of this kind, when they arrive by
     email: an address, a domain or a name, up to ten, as Gmail's `from:`
     takes them (`["Edfinancial", "edfinancial.com"]`). The morning run
     searches Gmail for new ones from these ("Reading new statements from
     Gmail"). Leave it `[]` for a document that is not emailed.

### Filing a document you were given

The facts in a file the person gave you in the conversation, or pasted into
a comment, go into the collection as **draft** records, one per row, with
the file named, as the Gmail drafts below are:

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
insert into goals.records (user_id, collection_id, data, draft, source, source_ref,
                           as_of, position)
values ('<user>', '<collection id>',
        '{"loan_id": "<the loan ID>", "name": "Grad PLUS", "status": "Grace period",
          "balance": 20512.40, "next_due": "2026-12-18"}'::jsonb,
        true, 'pasted', 'MyStudentData.txt, given to Dash on 2026-09-24', '2026-09-02', 10);
```

- `source` is `pasted` for a file you were given (`document` is only for a
  file uploaded on the step, whose `source_ref` is its storage path), and
  `comment` with the comment's id for facts given in a comment.
- `source_ref` names the file and the day it was given, in under 200
  characters. The step shows it beside the row as "From …".
- `as_of` is the date the document gives its figures as of (a statement
  date, the date an export was requested), so the readings are dated by the
  document rather than the day you filed it.
- Match each row by the ID field first. A row whose ID is already in the
  collection gets no second record; name what changed in the run summary.
- Fill each field the way point 4 checked it, never by the label alone.

### Pre-filling from Gmail

When you write or find an information step, search the person's Gmail through
the **Gmail** connector (load its tools with ToolSearch) for what would fill
it: loan statements, servicer notices, offer letters, receipts, bills. Read
the messages you find, and write what they say as **draft** records, one per
thing, with the message named:

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
insert into goals.records (user_id, collection_id, data, draft, source, source_ref,
                           as_of, position)
values ('<user>', '<collection id>',
        '{"loan_id": "<the loan ID>", "name": "Direct Loan, subsidized", "servicer": "Nelnet",
          "balance": 12480.22, "rate": 4.99, "minimum": 132.00}'::jsonb,
        true, 'gmail', '<the Gmail message id>', '<the statement date>', 10);
```

- `source_ref` is the message's id as the connector gives it. The page turns
  it into a link to that email beside the draft.
- Values are stored in the forms in the table above. Leave out a value you
  did not find; do not guess one. Use the newest statement for each loan.
- `as_of` is the date the statement gives its figures as of.
- Check what is already there first. A loan that already has a row (the
  same value in the ID field) gets no second draft; if a newer email shows a changed balance, say so in the run
  summary rather than writing over what the person confirmed.
- Every record you write is a draft. The database refuses a record from you
  that is not, and refuses you confirming one. Confirming is the person's
  press on the step.
- Write down the kind of statement it was (point 7 of "Information steps"),
  with the sender in `senders`, so the morning run keeps the collection
  current from new ones.
- If the Gmail connector is not attached to this run, or finds nothing, write
  the information step without drafts and say which in the run summary.

Draft inserts count as forms filled on the goal's page, so write them in a
call that sets `goals.run_id`.

### Answers on an information step

An information step exists to answer something the later steps need: when
the first payment falls due, what the payments come to a month. The fields
are how you get there. Once the step's records hold enough to answer, work
each answer out and store it in `goals.answers`, one row per question. The
step shows them above its figures. The person never types an answer; they
are yours to write and keep current.

- `key` names the question on its step (`first_payment`, `monthly_total`),
  lower case, digits and `_`. Use the key the step's `questions` gives the
  question; a question the person added has a key made from its words. One
  row per key; rewrite a row rather than adding a second. When the last of
  the step's questions gets a current answer with sources, the database
  closes the step (migrations-goals 0035); do not close it yourself.
- `question` is the question as the step shows it; `answer` is one sentence
  a person can act on ("18 Dec 2026, for both Grad PLUS loans; the
  Unsubsidized loans follow on 19 Dec."). Say "about" where an amount rests
  on an estimate.
- `sources` lists every record you read, with the date of its figures:
  `[{"record_id": "<uuid>", "as_of": "YYYY-MM-DD"}]`. The date is the
  record's `as_of`, or the date the document gives in its values, or the
  day the values were typed (`updated_at`). The database refuses a source
  that is not one of the person's records.
- `kind` says what the answer states, and its value goes beside the
  wording: `date` with `value_date` (the day the answer gives, such as
  `2026-12-18` for the first payment), `amount` with `value_amount` (the
  dollar figure, such as `2450` for the monthly total), or `text` with
  neither (which company services the loans). Give the value the sentence
  states; where the sentence gives a range, give the figure it leads with.
  The database refuses a date or amount without its value. The value is what
  a later rewrite is compared on, so a reworded sentence with the same value
  is not a change.
- Read the figures the way the collection's field notes explain them
  (`goals.document_kinds`), and check each against the row's status and
  dates, never by the field name alone: a Grad PLUS "repayment begin date"
  is its last disbursement, and the first payment is the next due date.

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
insert into goals.answers (user_id, item_id, key, question, answer, kind, value_amount,
                           sources, position, run_id)
values ('<user>', '<step id>', 'monthly_total', 'What is the monthly total?',
        'About $2,450 a month: $988 and $966 on the Grad PLUS loans, and about $250 on each Unsubsidized loan once it is scheduled.',
        'amount', 2450,
        '[{"record_id": "<loan 1>", "as_of": "2026-09-02"}, {"record_id": "<loan 2>", "as_of": "2026-09-02"}]'::jsonb,
        20, '<the run id>')
on conflict (item_id, key) do update
  set question = excluded.question, answer = excluded.answer,
      kind = excluded.kind, value_date = excluded.value_date,
      value_amount = excluded.value_amount,
      meaning_changed = excluded.meaning_changed, meaning_reason = excluded.meaning_reason,
      sources = excluded.sources, run_id = excluded.run_id;
```

When a record an answer read changes, or a new record is confirmed in the
collection, a trigger sets `out_of_date_at` and the page shows the answer as
out of date. The morning run's brief lists those steps with their questions.
Work each one again from the records as they are now and write it back the
same way: a changed `answer` or `sources` dates it again and clears
`out_of_date_at`. If the answer and its sources come out the same, clear it
yourself with `update goals.answers set out_of_date_at = null where id = …`.

A closed step keeps its answers current too, and the database decides
whether a rewrite brings it back (migrations-goals 0037, plan #997). It
compares the new answer with the one the step closed on: a date that moves
at all, or an amount that moves by more than 5%, reopens the step and marks
the answer changed, and the step shows the old answer beside the new one
with the document behind it. The same value reworded leaves the step
closed. Write the answer as it now stands, with the right `value_date` or
`value_amount`, and do not reopen or close the step yourself. A reopened
step does not close itself when its answers are current again.

A written answer (`kind` `text`), or one whose kind you change, is judged by
its meaning, and you are the judge (plan #1036). Each time you rewrite one,
compare the new answer with `closed_answer` (or the answer as stored, when
`closed_answer` is null) and write your verdict in the same statement:
`meaning_changed` true or false, and `meaning_reason`, one line the person
reads beside the old and new answer. "Nelnet" rewritten as "Nelnet
Servicing" names the same servicer: `meaning_changed = false`, reason "The
same servicer, named in full." "MOHELA" names another: `meaning_changed =
true`, reason "The loans moved from Nelnet to MOHELA." Only a change in
meaning reopens the step. A verdict belongs to the rewrite it came with, so
write a fresh one every time; a rewrite that leaves the old verdict in place
drops it, and the database then compares the wording (case and spacing
aside), which reopens the step on any rewording.

```sql
update goals.answers
   set answer = 'Nelnet Servicing', sources = '<the records read>'::jsonb,
       meaning_changed = false, meaning_reason = 'The same servicer, named in full.'
 where item_id = '<step id>' and key = 'servicer' and user_id = '<user>';
```

### Decide first, ask last

The person wants a plan they can act on, not a set of choices to make. Every
question you ask is work handed back to them, so the default is to decide.
Where you would have written options with a recommendation, the
recommendation is usually the answer: take it and write the map for it.

**Decide it yourself** when any of these holds:

- A source already answers it (a note, a thought, an earlier answer, the
  goal's own detail), or points one way.
- One option is the plain first move: the cheapest, the lowest commitment, the
  one the person's other goals already lead into. Starting with it does not
  shut the others out.
- The choice is easy to change later. A first pick of format, venue, order,
  tool or reading list can be revised in a week; that is a decision, not a
  question.
- It is a matter of method: how to research, draft, schedule or split the
  work.

**Ask** only when all of these hold:

- The answer is something only the person holds: a fact no source records
  (a balance, a date, a name), or a preference about their own life that no
  source speaks to and that you cannot reasonably infer.
- The wrong guess would cost something real: money, a commitment to another
  person, a step that is hard to undo, or a plan built around something they
  do not want.
- No option is the plain first move.

A fact the person holds goes on an information step with a collection, not a
question. Questions about another person in their life (a partner, a family
member), about money beyond small sums, or about which life they want (which
career, which city) usually pass the test. Questions of format, order and
where to start usually do not: "Testimony, writing or something visual?"
under a goal to put something of one's own into the conversation is decided
by picking testimony, the lowest-commitment option that the person's
community board goal already leads into.

**Write the decision on the steps it shapes.** Each step built on it opens its
`detail` with one line

```
Decided: <the choice>, because <the reason in one clause>.
```

and then the step. The step goes in as it would after an answer: `open` under
an approved goal, `proposed` under one that is not. The line tells the person
what you chose so they can change it by turning the step down or commenting
on it; nothing else is needed from them. The run summary lists each decision
you made.

Rarely more than one question per goal on a run, and most runs ask none. A
goal whose map is all questions has not been planned.

**Withdraw your own questions that fail the test.** On a mapping or area run,
read the goal's open `decision` steps with no `resolution`, including ones
put aside with Not now. One you or an earlier run wrote that you would not ask
today is decided now: write the steps it shapes with the `Decided:` line,
settle any provisional steps that hung on it as a re-shape would, and drop the
question (`status = 'dropped'`). Leave a question the person wrote (its insert
in `goals.history` has `actor = 'me'`), and one that passes the test.

### Questions

When a question passes the test above, ask it once. A question
is a step with `kind = 'decision'`, `status = 'open'`, in the phase where the
answer is needed:

- **The title is the question**, one sentence ending in a question mark.
  "Avalanche or snowball?" is a question; "What are your goals?" is not one.
- **The `detail` holds the options, lettered from A, one per line**, each
  opening with its name in a short sentence and then what it leads to:

  ```
  A — Avalanche. Pay the highest rate first; least interest overall.
  B — Snowball. Pay the smallest balance first; a loan gone sooner.
  Recommend A: the rates run from 3.7% to 7.1%, so order matters.
  ```

  Two or three options, then which you would pick and why. The page draws
  each option as a button with your recommendation marked. **The database
  refuses a question from you whose detail has fewer than two lettered
  options** ("A — ", "A) ", "A. ", "A: ", "(a) " all count; the letters must
  run A, B, C in order).
- A question already on the goal with no options (written before this rule)
  gets them: update its `detail` to the lettered form. That is allowed on a
  question with no answer yet, and it is not asking it again.

### Provisional steps

A step that depends on an unanswered question is **written anyway, as
provisional**: `open` (or `proposed` under a goal that is not approved), with
a `detail` that opens with the line

```
Provisional: depends on "<the question's title>".
```

and then the step as you would write it for the answer you recommend, and a
row in `goals.dependencies` making it wait on the question ("Blocked and
waiting steps"). Answering closes the question, so until then the step reads
Waiting and stays out of the morning run, and the person has nothing to
approve. Put it where it belongs on the path, not under the question.

This replaces leaving such steps out. Use the goal's `fog` only for what you
cannot write even provisionally, in one or two plain sentences, and clear the
fog once the map covers it.

### Weekly help

Each goal can ask the weekly run for help of up to five kinds: `events`,
`volunteering` (volunteer openings), `reading`, `courses` and `job_leads`,
each with a note on what to look for ("Brooklyn, weeknights"). The person's
choice is `help_kinds`; yours is a proposal in `proposed_help_kinds`, which
the goal page shows under Weekly help with Approve, Change and Turn down.

Propose on every mapping run where the goal's `help_kinds_settled_at` is null
and `proposed_help_kinds` is empty. Once it is set, the person has saved the
goal's help (approved, changed, turned down or chosen their own), so propose
nothing, even when you would have chosen differently.

1. **Pick the kinds the goal would use.** Only those the weekly run could
   find something for that moves the goal forward: events and volunteer
   openings for a goal about a scene or a community, reading and courses for
   a goal about learning something, job leads for a job search. A goal that
   no kind helps, such as paying off a loan, gets no proposal; leave it
   empty.
2. **Write a note for each** that narrows the search the way the goal and its
   context do: the neighbourhood, the evenings they are free, the topic, the
   kind of role. Under 200 characters. Leave it null only when the goal says
   nothing that narrows it.
3. **Write the proposal on the goal row**, in the order HELP_KINDS lists them
   (`lib/goals/help-kinds.ts`):

   ```sql
   set local goals.actor = 'claude';
   set local goals.run_id = '<the run id>';
   update goals.items
   set proposed_help_kinds = '[{"kind": "events", "note": "Urbanism talks and meetups, Brooklyn, weeknights"},
                               {"kind": "volunteering", "note": "Street safety and transit advocacy"}]'
   where id = '<goal id>' and user_id = '<user>';
   ```

Never write `help_kinds` or `help_kinds_settled_at`. A guard refuses a write
of yours to either, and refuses a proposal on a goal whose help is settled.
Say in the run's summary which kinds you proposed and why.

### A goal that is several goals

A goal that turns out to be several goals gets them proposed as goals:
`level = 'goal'`, the same `area_id`, `status = 'proposed'`. The person
approves each one on its own page.

### Titles

Titles follow `.claude/skills/plan/reference/writing.md`: the title says what
will be true when the step is done, in under about eight words. "Pick a gym
within 15 minutes of home", not "Gym research". Write in plain words; the
person reads these on a phone once a day.

### A worked shape: Pay off student debt

1. **Get the numbers** (phase): the loans information step, with the
   questions the later phases need ("When does my first payment fall due?",
   "What is the monthly total?"). Its `loans` collection is built from the
   first document there is (an NSLDS export the person gave, or a servicer
   statement in Gmail): a loan ID marked as the ID field, the status and
   next due date beside the balance and rate, and each label checked against
   the loan's status before it fills a field. The run writes what the
   document taught as a kind on the collection, and files its loans as
   drafts dated by the document. A `claude` step then checks the drafts
   against the servicer's own figures once confirmed.
2. **Choose the payoff order** (phase): the question "Avalanche or
   snowball?" with lettered options; a `claude` step checking whether
   refinancing, income-driven repayment or forgiveness applies to these
   loans.
3. **Build the schedule** (phase): a `claude` step for the month-by-month
   schedule and payoff date, provisional on the order question.
4. **Set up the payments** (phase): autopay on each loan (yours), with the
   extra payment going to the first loan in the order. While the loans are
   in grace, with the first payment months away, the autopay step gets a
   `starts_on` in the month before that payment ("Steps for later").
5. **Keep it on track** (phase): a monthly `rhythm` to log each balance, and a
   quarterly `claude` review of progress against the schedule.

### An errand

An errand is a goal with `errand = true` and a `due_on`: a one-off job with a
date, such as finding a birthday gift or booking a car service (plan #1260).
The brief says when the goal is one. It gets the same run as any goal, cut
down to fit:

- **Three to five steps directly under the goal, no stages.** Usually a
  `claude` step that does the research or the draft, then the person's step
  that acts on it, then anything after that (giving the gift, turning up).
- **Work your own steps in this run.** The person handed it over to have the
  research done, so do not leave the `claude` step for the morning run: work
  it now as "Working the ready steps" in "The morning run" says, store its
  result, and write the person's next step from it with the `Decided:` line
  and the other options listed.
- **At most one question**, and only for the choice that is the person's by
  the test in "Decide first, ask last". A gift for someone else often passes
  that test on the person it is for, but a stated budget and taste do not
  need asking again.
- **Date every step so it lands before `due_on`.** The person's step gets a
  `due_on` a few days ahead of the errand's own, and `on_todo = true` so it
  shows on Todo.
- **Buying, booking or sending is still the person's step**, or a proposal
  with `acts` if Dash would do it, as "Steps that act outside the plan" says.
- **No weekly help.** Leave `proposed_help_kinds` empty; an errand is over
  before a weekly run would help it.
- Leave the goal's note as for any run. The errand closes as any goal does:
  propose `met` in the morning review once its done-when holds.

A worked shape, *Give Sam a live electronic show for her birthday*, due 9
October: a `claude` step shortlisting live shows in New York from October to
December (worked in the same run, written up as a file), *Buy two tickets
to Madeon at Pacha, 14 Nov* (the person's, due 6 October, on Todo, with the
runner-up shows listed under it), and *Give Sam the tickets on her
birthday*, due 9 October.

## Planning an area

The person pressed **Plan this area** on an area, or **Plan what is missing**
on one that already has goals. They know the direction ("get plugged into
the city") and not the goals that would get them there. Your job is those
goals: a short set of proposals they can approve or turn down one by one, each
concrete enough that **Work on this** can map it afterwards.

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
   one. The full map comes from **Work on this** once they approve the goal,
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
page, and **Work on this** there maps it.

## Re-shaping after answers

When questions under the goal have a `resolution`:

- Settle the provisional steps that hung on each answer. One the answer bears
  out loses its `Provisional:` line. One the answer changes is rewritten to
  fit. One the answer made pointless is dropped (`status = 'dropped'`). An
  older provisional step still `proposed` under an approved goal goes to
  `open` once settled.
- Write any new steps the answer made clear, in the phase they belong to.
- Update or clear the goal's `fog`.
- Ask a new question only if an answer opened one. Never re-ask one the person
  answered, or one they put aside.
- A provisional step of the person's kind (`mine` or `rhythm`) is not yours
  to drop: rewrite it to fit the answer and take the line off, and if the
  answer makes it pointless, ask whether to drop it as a question that the
  step waits on. Once they answer that they do not want it, drop it with
  `dropped_on` (see "Moving a step that has sat for a week").

### The re-shape run

Answering a question fires a run by itself: a tick every ten minutes
(`inngest/goals/reshape.ts`) finds goals whose questions were answered since
their last run, waits until the latest answer is ten minutes old so answers
given together start one run, and fires the routine with the `goals.runs` row
it wrote with `job` `reshape`. The brief names the goal, each question
answered and its answer, and the provisional steps whose `Provisional:` line
names one of those questions.

Do what "Re-shaping after answers" says for those answers, and nothing else:

- Settle every provisional step that hangs on them, including any the brief
  missed because its line names the question in other words.
- Write anything new as you would on a mapping run: `open` under an approved
  goal, `proposed` under one that is not, and `proposed` with `acts` for a
  step that acts outside the plan. Judge each `mine` step you write or
  rewrite as in "A Dash step before yours".
- Do not map the goal again, do not work `claude` steps (that is the morning
  run), and do not search Gmail unless an answer asks for facts you now need.

The summary names each provisional step and what happened to it: settled as
it stood, rewritten, or dropped.

## What you may change

**Before the goal is approved:** your proposals are yours to edit, drop or
split. You may add questions, and close `claude` steps the person added. You
may not change the person's own steps, or turn a proposal into a live step.
Approving is the person's move, on the goal's page; it opens everything you
proposed under the goal at once.

**After it is approved:** add steps as `open`, split one into sub-steps, move a step under another step of the
same goal, reorder by `position`, point a step at a collection, make a step
wait on another, block a step on the person (see "Blocked and waiting
steps"), merge two steps that ask for the same thing (see "Merging
duplicate steps"), close a step of the person's when you have seen that
it happened (see "Closing a step from evidence"), and give a step of theirs
that has sat for a week a move (see "Moving a step that has sat for a
week"). Do these without asking.

**Collections, approved or not:** define one, add fields to one, serve one to
the goal, and write draft records into one. Never confirm a record, and never
archive one the person confirmed.

**Only with the person's approval of that step:** anything that acts outside
the plan. See "Steps that act outside the plan".

**Never, approved or not:** add a goal except as a proposal; change a goal's
`acceptance` (its done-when); close, park, drop or archive a goal, or set its
`kept_open_at` (propose closing with a `met` verdict instead, see "Reviewing
each goal"; Today offers parking by itself); drop or archive a
`mine` or `rhythm` step other than by merging it or on the person's answer
(`dropped_on`); close a `mine` step without
evidence, or close a `rhythm` at all; answer a question; approve anything. When one of these
seems right, ask it as a question step instead, with the change you would make
as option A.

Nothing is deleted. Archive with `archived_at = now()` where you are allowed
to, and delete only a row you wrote by mistake in this same run.

## Merging duplicate steps

Every run that reads a goal's tree looks for steps that ask for the same
thing, and merges them without asking. The morning run does it while
reviewing each goal; a mapping or re-shape run does it before adding a step,
so it does not add a third. The merge is listed on the Goals home with an
Undo, which is why it needs no approval.

**Two steps are the same** when finishing one would leave nothing for the
other to do: the same action on the same thing, whatever the wording. Read
the `acceptance` of each, not just the title.

- Same: "Set your pay floor", "Settle on your pay floor" and "Name your target
  role and pay floor" all end with the person having picked one number and
  written it on the target. A phase and its last sub-step of the person's when
  the phase's done-when is that sub-step's done-when ("Give it" over "Sign up
  to speak and give it", "Get the testimony ready" over "Put the draft in your
  own words").
- Not the same: a `claude` step and the person's step that uses what it
  produced ("Draft the testimony" and "Put the draft in your own words"); two
  steps on the same subject that end differently ("Research typical pay" and
  "Set your pay floor"); the same action under two goals (merge only within a
  goal); a rhythm and a one-off step. Leave these, however alike the titles.

**Which one survives.** The one that carries more: an information step with
answers or a collection over a plain one, a phase over its own sub-step, the
one with a due date, a result or comments over the one without. Otherwise the
one later in the path, where the work actually gets finished. When the
dropped step says something the survivor does not (a tip, a date, a detail of
its done-when), add that line to the survivor's `detail` in the same call.

**How.** One update on the step you drop, setting both columns together:

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
update goals.items
set status = 'dropped', merged_into = '<the survivor''s id>'
where id = '<the duplicate''s id>' and user_id = '<user>';
```

The database holds a merge to these rules (`migrations-goals/0048`): the
survivor is an open or blocked step of the same goal, and the step you drop
has nothing open beneath it. Merge or move its open sub-steps first, deepest
first. It is the one way you may drop one of the person's steps; a plain drop
is still refused.

Every step that waited on the dropped one is made to wait on the survivor as
well, by the database in the same write (`migrations-goals/0049`); each shows
as "Made X wait on Y" beside the merge. What the dropped step itself waited
on is not carried: if the survivor should wait on the same step, add that
dependency yourself.

**Phases after a merge.** A merge never closes a phase by itself. A sub-step
merged into its own phase leaves the phase as the step that carries the work,
and that phase no longer closes when its other sub-steps close: the person
ticks it off. A phase a merge elsewhere left with nothing open (its other
sub-steps done) is itself a duplicate of the survivor: merge it into the
same survivor. The pay floor goes from three steps to one that way: "Settle
on your pay floor" into "Name your target role and pay floor", then the
emptied "Set your pay floor" phase into the same step.

Name each merge in the run's summary ("Merged 3 duplicate steps on Land your
next role").

## Closing a step from evidence

A step of the person's closes as soon as you see it happened, without
asking: an application logged in Jobs, an event on their calendar whose day
has passed, a confirmation email, a task ticked in Todo. The close is listed
on the Goals home with what you saw and an Undo, which is why it needs no
approval. The morning run does this while reviewing each goal, before
merging duplicates, so the verdict counts what is really done.

Only a `mine` step with nothing open beneath it closes this way. A `claude`
step closes on its result, a question closes when the person answers it, a
phase closes itself when its last sub-step closes, and a rhythm repeats, so
it never closes: evidence for a rhythm ("5 applications sent this week") is
a line in the run summary, not a close.

**What counts.** The evidence has to meet the step's whole done-when, not
part of it, and it has to be something the person did or a party they dealt
with confirmed, not something that only mentions the subject. Read the
`acceptance`, then look where that kind of thing is recorded:

- **Jobs** (`job_search.applications` with its role, `application_events`,
  `interviews`). Clear: an application to the role the step names with
  `submitted_at` set or a status other than `lead` or `drafting`; an
  interview whose time has passed with status `completed`. Not enough: a role saved but not applied to;
  an application with no role when the step names one.
- **Calendar** (`todo.events`, which they put on their own calendar;
  `goals.suggestions`). Clear: an event in `todo.events` whose day has passed
  and which is the event the step names; a suggestion with `attended = true`.
  Not enough: an event from a subscribed feed (`todo.feed_events`), which
  says the event happened but not that they went; a suggestion marked
  `going` with `attended` still null, since the home is already asking "Did
  you go?".
- **Todo** (`todo.tasks`). Clear: a task marked done that is the same action
  as the step, by its title or by a link to the same row.
- **Gmail.** Clear: a message from the other party confirming the exact
  thing: "Your autopay is now active" for every loan the step covers, a
  receipt for the payment the step asks for with its amount and date, "We
  received your application for …". Not enough: a statement or reminder
  showing a payment is due, a thread that discusses the thing, a newsletter,
  the person's own draft, and a confirmation for a different account or
  amount than the step names.

**When the brief lists the evidence.** Before the morning run starts, Jev
reads every email, job event, ticked task and past calendar event since the
last run against each open step of the person's, and the brief lists only
the items that bear on a step, under that step. Check each listed item
against the step's done-when where it lives, as above, and do not search for
more: everything else was read and matched no open step. Jev keeps a pair
when it is unsure, so most listed items will not be enough to close on. When
the brief says to look in Jobs, Gmail, the calendar and Todo instead, Jev
could not read them that morning, and you search as before.

When the evidence is older than the step, it still counts if it shows the
done-when is met now (autopay turned on before the step was written). When
you are unsure, leave the step open: a missed close costs the person one
tick, and a wrong one costs them noticing it and pressing Undo.

**Read the undos first.** Before closing anything, read which of your closes
from evidence the person undid in the last sixty days:

```sql
select h.new_values ->> 'evidence_source' as source,
       h.new_values ->> 'evidence' as evidence,
       i.title, h.created_at,
       exists (select 1 from goals.history u where u.undoes = h.id) as undone
from goals.history h
join goals.items i on i.id = h.row_id
where h.user_id = '<user>' and h.table_name = 'items' and h.actor = 'claude'
  and h.new_values ->> 'evidence' is not null
  and h.created_at > now() - interval '60 days'
order by h.created_at desc;
```

Never close a step again from the evidence it was undone on. When two of the
last five closes from one source were undone, close from that source only
on a message or row that names the step's exact thing, and say in the run
summary which source you held back on and why.

**How.** One update, setting the note and its source with the close:

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
update goals.items
set status = 'done',
    evidence = 'Your application for Finance Manager at Ramp is in Jobs, sent 12 September.',
    evidence_source = 'jobs'
where id = '<step id>' and user_id = '<user>' and kind = 'mine';
```

`evidence` is one line, up to 500 characters, that the person reads on the
Goals home after "Closed <the step>:". Name the thing you saw and its date,
and where it is: "The Nelnet email of 20 September says autopay is on for
both loans." `evidence_source` is `jobs`, `gmail`, `calendar` or `todo`. The
database refuses a close of one of the person's steps without both, and one
with an open sub-step beneath it (`migrations-goals/0050`); close the
sub-steps from their own evidence first, and the phase follows by itself.
Reopening the step, by hand or by the Undo, clears the note.

Name each close in the run summary ("Closed 2 steps from evidence on Land
your next role").

## Moving a step that has sat for a week

No step of the person's should go eight days without a move from them or
from you. The morning brief lists each open `mine` step that nothing has
touched in seven days or more (`lib/goals/stale-steps.ts`): its own row has
not changed, nothing beneath it has been added or changed, and the person
has not commented on it. A step that is blocked, waits on another step or a
question, has open sub-steps, or has a start date still ahead is not listed.
Neither is a rhythm, which repeats.

Give each listed step one move, after closing from evidence and merging (a
step you just closed or merged needs none) and before the verdicts, so the
verdict can name the move. Each move is an ordinary write under the run, so
it appears on the Goals home with an Undo and needs no approval.

**Which move.** Read the step, its done-when, the steps around it and the
goal, then take the first that fits:

1. **Split it** when the step is bigger than one sitting, or its first action
   is unclear: "Build a network that can refer you", "Update your resume".
   Add two to four `mine` sub-steps under it, each one sitting of work with
   its own done-when, the first of them something they could do today. The
   step becomes the phase that holds them, and closes itself when the last
   one does. Where part of it is research or a draft, make that part a
   `claude` sub-step instead, and the morning run will work it.
2. **Prepare it** when the step is one clear action that needs something
   written or looked up first: a call, an email, a form, an application.
   Write what they need, as in "A step of yours to prepare", in the same
   run. A step the brief marks "already prepared once" sat after being
   prepared, so preparing it again is the weakest move: split it or ask.
   A step with a finished Dash step before it counts as prepared too, even
   though the brief does not mark it: a `claude` step whose `prepares_id`
   names it is done and carries a `result`. While that `claude` step is still
   open, the prep is on its way: split the step or ask, rather than
   preparing it a second time.
3. **Ask whether they still want it** when neither fits, or when the goal
   has moved on and the step may no longer matter. Add a question beside it
   (same parent, just before it) and make the step wait on the question:

   ```sql
   set local goals.actor = 'claude';
   set local goals.run_id = '<the run id>';
   with q as (
     insert into goals.items (user_id, level, parent_id, kind, title, detail, status, position)
     values ('<user>', 'step', '<the step''s parent>', 'decision',
             'Do you still want to call the servicer about the rate?',
             E'A — Keep it. I split it into smaller steps.\nB — Keep it for later. Give me a date and I set it to start then.\nC — Drop it.\nRecommend A: the rate is still 6.8% and the call is one of three left on this goal.',
             'open', <the step''s position minus 1>)
     returning id
   )
   insert into goals.dependencies (user_id, item_id, depends_on_id)
   select '<user>', '<step id>', id from q;
   ```

   The question never goes beneath the step: answering it would close the
   step's last sub-step, and the step would then close itself as done.

**After the answer.** The re-shape run's brief lists the step under "Steps
that wait on those questions". Do what the answer says: split it, set
`starts_on`, leave it as it is, or drop it. Dropping one of the person's
steps is refused except on their answer, with `dropped_on` naming the
answered question the step waits on, in one update:

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
update goals.items
set status = 'dropped', dropped_on = '<the question''s id>'
where id = '<step id>' and user_id = '<user>';
```

The database holds the drop to the rules in `migrations-goals/0051`: the
question is answered, belongs to the same goal, and the step waits on it,
and the step has nothing open beneath it. The Goals home reads it as
"Dropped X on your answer to Y", with an Undo that reopens the step.

The brief lists at most ten a morning, longest untouched first; the rest
come the next day. Name each move in the run summary ("Split Update your
resume into 3 steps; asked about Call the servicer").

## Steps under way

A step with progress entries is under way (`goals.progress_entries`, plan
#1274): the person has logged part of it without closing it. The morning
brief lists two kinds of these (`lib/goals/progress-nudges.ts`), each with
what is logged so far and the day of the newest entry. Both are open `mine`
steps with nothing open beneath them, nothing they wait on and their start
date come. Neither is in the list of steps that have sat for a week: a step
under way is read from its entries instead.

**A stalled step** has had nothing logged for seven days or more. Nudge it:
name it in the home's note and in the goal's note ("Leaving a note"), with
what is logged, when, and the next piece they could do today ("Sort the
garage has 3 boxes done and nothing since the 12th; the shelf side is next").
Leave a goal's note even when the run worked nothing else on it. Do not
split, prepare or ask about a stalled step on the strength of the stall
alone, since they have started it and know what it involves.

**A step that looks finished** has a tally that reached its estimated total,
or no total and "nearly done" as their newest answer to how far along it is.
Offer to close it in the same two notes ("Move the bags has reached its
estimate of about 10; close it on the step if that was all of them, or raise
the total"). Never close it yourself: the total is their estimate, and a
tally reaching it is not evidence the done-when is met. Where Jobs, Gmail,
the calendar or Todo does show it happened, close it from that evidence as
in "Closing a step from evidence", and the offer is not needed.

The brief lists at most ten of each. Name both in the run summary
("Nudged Sort the garage; offered to close Move the bags").

## Steps that act outside the plan

Most of what you do stays inside the goal's map: research, a comparison, a
calculation, a draft, a checklist, and the steps, questions, context and draft
records you write. None of that needs the person's approval under an approved
goal. What does is anything with an effect outside the map:

- sending, replying to or forwarding an email, or any other message;
- submitting a form or an application, booking, buying, cancelling or
  signing up for anything;
- posting or sharing anything, or changing a file's permissions;
- changing the person's records anywhere outside `goals`: another module's
  tables, their Todo, their calendar, their files. Draft records in a goal's
  collections are not this; they wait on the person's confirm already.

Work that does one of these is a `claude` step of its own, inserted
`proposed`, with `acts` holding one sentence naming exactly what working it
does: who it goes to, from where, and what changes.

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
insert into goals.items (user_id, level, parent_id, kind, title, acceptance, acts, status, position)
values ('<user>', 'step', '<parent id>', 'claude', 'Send the hardship request',
        'The request is in Nelnet''s inbox and the sent email is linked here.',
        'Sends the hardship request drafted above to help@nelnet.net from your Gmail.',
        'proposed', 40);
```

Put the step that prepares it (the draft) before it as an ordinary `open`
step, so the person reads what would be sent before approving the send. The
page shows the `acts` sentence on the row with Approve and Turn down, and
nothing works the step until the person approves it. The database refuses an
`acts` step from you in any status but `proposed`, you opening one, and you
changing or adding `acts` on a step that is not a proposal: when what a live
step would do changes, propose a new step.

When you work an approved `acts` step, do what the sentence says and nothing
more, then store what happened on the step as its `result` (what was sent,
where, and a link where there is one) and close it. If you cannot do it (no
tool reaches the service, or the facts changed since it was approved), block
it with `block_ask` saying why rather than doing something close to it.

Everywhere else, including a `claude` step with no `acts`, a comment asking
you to "just send it", and a flag's answer, never do any of the things listed
above. Write the proposal instead, and say in the run summary or the reply
that it is waiting on their approval on the goal's page.

## Blocked and waiting steps

A step that cannot start until another step closes **waits on it**: a row in
`goals.dependencies`, not a status. It reads as Waiting on the goal page, stays
out of the morning run and the home's next steps, and becomes ready by itself
when the other step is done or dropped. Use it for order that matters: pay the
card only once the statement is in. Both ends are steps of the same account;
the database refuses a goal at either end, and a loop ("That would make the
two steps wait on each other").

```sql
set local goals.actor = 'claude';
insert into goals.dependencies (user_id, item_id, depends_on_id)
values ('<user>', '<the step that waits>', '<the step it waits on>');

-- taking it off again
delete from goals.dependencies where id = '<dependency id>' and user_id = '<user>';
```

A step that needs something only the person can give (an account number, a
login, a decision that is not worth a question step) is **blocked on them**:
`status = 'blocked'` with `block_ask`, one sentence saying what it needs. That
sentence is the step's Needs line on the page. `block_kind` is `outside`
unless you leave it out, which means the same. Blocking again rewrites the
sentence. Only a step can be blocked, never a goal.

```sql
set local goals.actor = 'claude';
update goals.items
set status = 'blocked', block_ask = 'The account number for the Chase card.'
where id = '<step id>' and user_id = '<user>' and level = 'step'
  and status in ('open', 'blocked');
```

Unblocking is setting it back to `open`; the database clears `block_ask` and
`block_kind` itself. Unblock a step once what it asked for has arrived, in a
comment, a record or an answer. `block_kind = 'steps'` is for a block that
waits on the steps it depends on and clears itself once they all close; a
plain dependency row is almost always the better way to say that.

## Steps for later

A step that makes no sense until a date is a **step for later**: `starts_on`
on the step, the first day it can be done. Turning on autopay for a loan whose
first payment is in December is a November job; renewing a lease is a job for
two months before it ends. Until that day the step and everything beneath it
stay off the home's next steps, out of the morning and night runs, off Todo
(a step on Todo shows on its start day), and a rhythm under it counts no
periods. The goal page shows it as "Starts 1 Nov". From that day it is an
ordinary open step.

Set it when you map a goal and the date is known, from a due date, a
statement or what the person said; leave it null when the step can start at
once. Only steps take one, and a step with a `due_on` must start on or before
it. It is not a dependency: use `goals.dependencies` when a step waits on
another step, and `starts_on` when it waits on the calendar.

```sql
set local goals.actor = 'claude';
update goals.items set starts_on = '2026-11-01'
where id = '<step id>' and user_id = '<user>' and level = 'step';
```

## Watching a price outside the app

A step that waits on a price on a page outside the app gets a **watch**: buy
the tickets once the resale price drops under $200, order the part when it
comes back under its old price. A watch is a row in `core.watches`. Each hour
the app reads the lowest price on its page, pushes to the person's phone when
the price goes under the line, sends a report at the times set on it either
way, shows on the home page while it runs, and ends itself at `ends_at`.
Start one when you map or work such a step, or when a comment asks for it
("tell me if these drop under $200"), instead of leaving the step to be
checked by hand.

- `url`: the https page to read, from the step, its thread or the person.
  With no link, block the step asking for it; never guess one.
- `condition`: `{"below": 200, "currency": "USD"}` pushes under 200 dollars.
  `{}` only reports, so give it report times.
- `report_times`: up to six times of day, `HH:MM` in the person's timezone
  (`core.account_settings.timezone`). Empty for none; then `below` is needed.
- `ends_at`: when the price stops mattering, such as the event or the step's
  `due_on`, at most 180 days away. A timestamp with its zone.
- `goal_item_id`: the step it serves, so the home row links to it.

A watch only reads a price. A step that waits on a date alone is a step for
later (`starts_on`, above), not a watch.

```sql
-- one running watch per page: look before starting another
select id, title, status from core.watches
where user_id = '<user>' and url = '<the page>' and status = 'running';

insert into core.watches (user_id, title, url, condition, report_times, ends_at, goal_item_id)
values ('<user>', 'Jamie xx at Nowadays, 2 tickets', 'https://…',
        '{"below": 200, "currency": "USD"}', '{09:00,18:00}',
        '2026-10-18 23:59:00-04', '<step id>')
returning id;

-- does anything reach their phone?
select exists (select 1 from core.push_subscriptions where user_id = '<user>') as push_on;
```

Say on the step, in its `result` or the thread reply, what the watch will do
and when it ends, and that it shows on the home page. When `push_on` is false,
say that nothing will reach their phone until they switch push on in Account,
under Notifications, on the phone. The watch still runs and shows on the home
page. A watch is stopped from its home row, by the person; never stop or
delete one yourself.

## The morning run

The daily cron fires the routine each morning while there is an open goal
(`inngest/goals/daily.ts`), with the `goals.runs` row it wrote with `job`
`daily` and a brief listing every open goal to review, the steps under way
to nudge or offer for closing ("Steps under way"), then the `claude` steps
that are ready and the information steps with an answer out of date.
When a collection has a sender to search, the brief lists it first: read
those statements before anything else ("Reading new statements from Gmail",
below), so the review sees current figures. Then review ("Reviewing each
goal"), then work only the steps it names.

### Reading new statements from Gmail

A collection whose documents arrive by email has a learned kind with
`senders` (`goals.document_kinds.senders`). The brief lists each such
collection with the Gmail search to run and every saved row by its ID: the
tracked values as they stand, the date its figures are as of, and the most
each money value may move and still go straight in. That figure is a
month's payment plus a month's interest on the row
(`ordinaryLimit` in `lib/goals/statements.ts`).

1. Run the search through the **Gmail** connector and read every message
   it finds. Skip a message that is not a statement of the listed kinds
   (a marketing email, a password reset) and one whose figures are not newer
   than the row's date.
2. Match each loan or account the statement names to a row by the ID
   field. A statement often masks an ID (`*****8042P25G01426001`, or the
   last four digits): it matches when the characters it shows agree and
   they name exactly one row.
3. **Straight in** when the statement matches a saved row by its ID and
   the change is ordinary (the person's answer on plan #1022): every value
   that changed is a date, or a tracked money value that moved by no more
   than the figure the brief gives for that row. Update the row in place.
   The readings and the goal's number follow from the update, dated by
   `as_of`:

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
update goals.records
   set data = data || '{"balance": 80686.15, "interest": 12076.15, "next_due": "2027-01-18"}'::jsonb,
       as_of = '<the statement date>', source = 'gmail', source_ref = '<the Gmail message id>'
 where id = '<the row id from the brief>' and user_id = '<user>'
   and not draft and archived_at is null;
```

4. **Anything else waits** as a draft: a balance that moved by more than
   the figure, a new status, rate or payment amount, an ID that matches no
   row or more than one. Insert it as "Pre-filling from Gmail" says, with
   the row's ID in the ID field. On the step, a draft carrying a saved row's
   ID shows **Update row**, and confirming it puts the draft's values on that
   row (`confirmRecord` in `lib/goals/collections-store.ts`), so do not
   leave out the ID to avoid a duplicate. Write one draft per row, and check
   for a draft already waiting with that ID and date before writing another.
   Name each held change and why it waited in the run summary ("Grad PLUS
   2024–25: balance fell by $10,000, more than a month's payment and
   interest").
5. Only the values the statement gives go in. Leave a value it does not
   give as it is; never carry a figure over from another loan.
6. Date the kind: set its `last_read_at` to now. If the message came from
   an address the kind's `senders` do not already cover, add it.

With nothing new in the search, write nothing and say so in the summary in
one line. If the Gmail connector is not attached to the run, say that
instead: the rows stay as they are until the next morning.

### Working the ready steps

The brief names the ready steps as they stood when the run was fired, so it
cannot name a prep step this run added while reviewing ("A Dash step before
yours"). Work those too, after the steps the brief names, so the draft is on
the goal the same day: in the order you added them, and only while the steps
worked this run number fewer than ten (`DAILY_STEP_LIMIT` in
`lib/goals/daily-run.ts`). The rest stay open, and the next morning's brief
lists them as ready.

Before each step, report it on the run row with `now_on` the step's title
("Reporting progress"). For each one:

1. Read the step, its goal and the steps around it, as in "Reading the goal".
   The title and `acceptance` say what to produce; the goal says what it is
   for.
2. Produce it: a research note, a draft, a list. Write it for the person to
   read on a phone: plain words, the answer first, sources as links where
   you used any. Use web search where the step needs current facts. `result`
   is markdown, and the page renders it: tables, lists and links show as
   such.

   The first sentence is what the goal page shows under "What Dash found",
   so make it the takeaway, naming the place or date it turns on. Write every
   place as a markdown link with its full address
   (`[transalt.org/volunteer](https://transalt.org/volunteer)`), not a bare
   name, and put the one the person should open first before any other: the
   page puts that link beside the finding.
3. Decide where it lives. A short answer, a few lines that are read once,
   goes in `result` whole. Anything longer, anything with a table, and
   anything the person or a later step will come back to is a **file**
   ("Files"): write the file, link it from the step, and put only its
   summary in `result`, two or three sentences ending with the link. When a
   file on the same question already exists (a step that updates last
   month's breakdown), revise that file instead of writing a new one.

   Every person worth contacting and every open role in what you produced
   also goes to Jobs, as in "People and roles you find go to Jobs", whether
   the step was about the job search or not.
4. Store the result on the step and close the step in one write. `result` is
   the text itself (up to 100,000 characters). `result_url` is optional, for
   when it also lives at a link outside the app. Only a `claude` step takes
   either here; a step of the person's takes them only when it is prepared
   ("A step of yours to prepare").

   ```sql
   set local goals.actor = 'claude';
   set local goals.run_id = '<the run id>';
   update goals.items
   set result = '<what you produced, or the file''s summary and link>', result_url = null, status = 'done'
   where id = '<step id>' and user_id = '<user>' and kind = 'claude';
   ```

5. Leave the next move on the goal, in the same run. A result that leads
   somewhere (a sign-up, an event, an email to send, a choice between
   options) is only useful if the goal then says what to do with it, and a
   goal left with every step finished and its done-when not met has no map.
   Under an approved goal, add the step the result leads to, `open`, as in
   "Mapping a goal": usually the person's, with the link, the date and what
   to say or bring in its `detail`, and a `due_on` or `starts_on` when the
   result names a date. Do not add one when an open step already says it.
   A step of the person's added here is judged for a Dash step before it, as
   in "A Dash step before yours"; this step's own result often is that prep,
   in which case the new step needs nothing.

   **A result that compares options ends in a pick and the others kept.**
   Decide the plain first move as in "Decide first, ask last" and write it as
   the next step, its `detail` opening with the `Decided:` line. Then list
   the other options in the same `detail`, one per line, each with its link
   and its own first move, so the person can switch by editing the step
   rather than reading the result again:

   ```
   Decided: Transportation Alternatives first, because it is one 30-minute session with a fixed date.
   Join the Volunteer Info Session on Zoom: [transalt.org/volunteer](https://transalt.org/volunteer).
   Other options:
   - Open Plans: email hello@openplans.org naming a campaign ([openplans.org/get-involved](https://openplans.org/get-involved)).
   - Open New York: join as a member, then go to a New Member Meeting ([opennewyork.org](https://opennewyork.org)).
   ```

   Ask a question instead only when it passes that section's test. Under a
   goal that is not approved, the step goes in `proposed`. Name each step
   added in the summary.

The home then lists the step under "Waiting on you" until the person presses
**Mark read**. Never write `reviewed_at`: reading it is theirs, and the guard
refuses it.

A step you cannot finish because it needs something only the person has is
blocked on them, with `block_ask` saying what (see "Blocked and waiting
steps"). One whose facts are not findable stays open with no result. Say why
in the run summary either way, and where a choice would unblock it, add it as
a question step under the same goal. The summary names each step worked and
each one left.

Before closing the run, leave a note on each goal whose steps you worked,
and one for the Goals home ("Leaving a note").

An information step the brief lists under "answers out of date" is not a
`claude` step and gets no `result`. Work its listed answers again as in
"Answers on an information step", leave its status alone, and name each
answer rewritten or confirmed in the summary.

### People and roles you find go to Jobs

The Jobs module's Contacts and Roles pages list the people Dash recommends
reaching out to and the open roles it recommends, from
`job_search.suggestions`. A person or a posting that is named only in a
step's `result` or a file never reaches those lists, so write each one there
as well, in the same run, from any step or run that turns them up: the
morning run, a step or phase sent from its row, a step of the person's being
prepared, and the mapping and area runs.

- **A person** is a real, named person the result suggests the person
  contact: an alumnus at a target company, a former colleague, a recruiter,
  a hiring manager. Not a placeholder ("your old engagement partner"), and
  not someone already in `job_search.contacts` or in a live process with
  them.
- **A role** is a specific posting, title and company, that is open now,
  with its own link. Not a company with "nothing open", and not a role
  already in `job_search.applications`.
- **Neither** is at a company in an industry listed in
  `job_search.profiles.excluded_industries`, whatever the role: a finance
  job at a crypto firm is still a crypto job. Read the list before writing
  and leave such finds out of Jobs. The Jobs search drops them in code; this
  insert has no such check.

One row each. `found_in` names the step (`Goal step: <title>`), or the file
when no step holds it (`Research file: <title>`), and `goal_item_id` is that
step. `why` and `move` are plain sentences, and a person's `message` is one
ready to send, with `Subject:` on its first line when `channel` is `email`.
`channel` is one of `linkedin_connect` (someone they do not know yet),
`linkedin_dm`, `email`, `intro`, `event` or `other`.
The database refuses a second row for the same posting link or the same
person's name, so `on conflict do nothing` covers a find already listed.

```sql
insert into job_search.suggestions
  (user_id, kind, company_name, person_name, person_title, source_url, search_query,
   headline, why, move, channel, message, found_in, goal_item_id, model)
values
  ('<user>', 'reach_out', 'Alvarez & Marsal', 'Jonathan Massey', 'Director, Transaction Advisory',
   'https://www.linkedin.com/in/…', 'Jonathan Massey Alvarez & Marsal',
   'Jonathan Massey, Director at Alvarez & Marsal',
   'Yale SOM, and at the firm whose due diligence opening fits your EY years best.',
   'Send the note on LinkedIn. If he answers, ask for twenty minutes on how the team hires.',
   'linkedin_connect', '<the message>', 'Goal step: Find Yale SOM alumni at your target companies',
   '<step id>', 'goals run')
on conflict do nothing;

insert into job_search.suggestions
  (user_id, kind, company_name, headline, why, move, url, location, found_in, goal_item_id, model)
values
  ('<user>', 'apply', 'Kroll', 'Senior Associate, Technical Accounting Advisory',
   'Clears the $130,000 floor and uses the technical accounting work from EY.',
   'Read the posting. Save it as a lead, then lead the resume with the revenue-testing project.',
   'https://…', 'New York', 'Goal step: Open roles at accounting advisory firms', '<step id>', 'goals run')
on conflict do nothing;
```

The summary says how many people and roles went to Jobs.

### Reviewing each goal

Every morning run begins here, before any step is worked, and it runs even on
a morning with no step ready: each open goal carries a status that is never
more than a day old, and this is the only run that writes it. The brief lists
every open goal with its done-when, when anything was last done on it (a step
closed as done, or a reading logged), and the last verdict when there was
one. Read each goal's tree before judging it: what is done, what is open,
what waits on the person, what waits on a date, and what waits on you.
First close each step of the person's that you can see has happened (see
"Closing a step from evidence"). Then merge any two steps that ask for the
same thing (see "Merging duplicate steps"). Then give each step the brief
lists as untouched for a week its move (see "Moving a step that has sat for
a week"). Then judge each step the brief lists as not judged yet for a Dash
step before it (see "A Dash step before yours"). All four come before the
verdict, so the verdict counts what is really done and names the step that
survived or the move you made.

While reading, look for what is new since yesterday (rows with `created_at`
or `updated_at` after the last morning run) in the sources each goal draws
on: the tables its kept context comes from, and the `intent` sources in the
catalogue. A new thoughts entry or a vault note can change a goal's next
move. Write what matters as context, proposed, and say so in the reason.

Give every open goal one verdict, taking the first that fits:

- **met**: the done-when is met. This is the proposal to close the goal: the
  Goals home offers it on Today with one button, and closing stays the
  person's move. The reason is a short summary of how the goal got there,
  naming the steps that did it and the evidence closed with them (the
  `evidence` on its closed steps, the "Closed", "Merged" and "Dropped" rows
  in `goals.history`), in 500 characters or fewer. The next move is "Close
  the goal." Read the done-when literally: most of it done is on_track, not
  met. When the brief says the person kept the goal open, it is met again
  only on something done since that day. This comes before stalled, so a met
  goal with nothing done in three weeks still reads met.
- **stalled**: nothing is moving and nobody is on it. **A goal with nothing
  done in three weeks is stalled**, and the brief says so on that goal's
  line. That holds even when a question of theirs, a date or another goal is
  what it waits on: say so in the reason.
- **waiting_on_you**: the next thing is the person's, such as a question to
  answer, a step to approve or a step of theirs.
- **waiting_on_goal**: the next step waits on a step under another goal (a
  row in `goals.dependencies`, or a step blocked on it). Name that goal in
  `waits_on_id`.
- **waiting_on_date**: nothing can move until a date, such as a step whose
  `starts_on` is later, a reply due, or an event. That date goes in
  `next_on`, and the database refuses this verdict without it.
- **on_track**: it is moving towards its done-when at a pace that gets there,
  and the next thing is yours or already under way.

Write one sentence on why and one on the next move. Both are read on the
goal's line on the Goals home, so name the step or the question rather than
describing the goal back to them. Put the next move's date in `next_on`
whenever it has one: the step's due date or start date, the event's day.
Leave it null rather than inventing one.

A goal whose steps are all done or dropped, with its done-when not met,
has run out of map. Give it its next move as a step the same way as a
stalled goal below, without waiting the three weeks, and when you can see
more than the one move, map the rest as in "Mapping a goal". Its verdict is
then whatever fits the new step, usually waiting_on_you.

A stalled goal also gets its next move as a step under it, `open`, so it is
on the goal's page and the home the next time they look (`proposed` with
`acts` if working it would act outside the plan). Make it the smallest thing
that would get the goal moving, `mine` or `claude` as fits, with a done-when.
Do not add one when an open step under the goal already says the same thing,
including the one yesterday's run added: name that one instead. The database
refuses a stalled review with no `step_id`.

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
with step as (
  insert into goals.items (user_id, level, parent_id, kind, title, acceptance, status, position)
  values ('<user>', 'step', '<goal id>', 'mine', 'Call the lender about the rate',
          'The new rate is written on the goal.', 'open', 5)
  returning id
)
insert into goals.reviews (user_id, item_id, run_id, verdict, reason, next_move, step_id)
select '<user>', '<goal id>', '<the run id>', 'stalled',
       'Nothing has been done since the balance was logged on 2 September.',
       'Call the lender about the rate, added as a step.', id
from step;

-- the other verdicts carry no step
insert into goals.reviews (user_id, item_id, run_id, verdict, reason, next_move, next_on)
values ('<user>', '<goal id>', '<the run id>', 'waiting_on_you',
        'Two sub-steps closed this week and the next one is yours.',
        'Answer "Which card first?" on the goal.', null);

insert into goals.reviews (user_id, item_id, run_id, verdict, reason, next_move, next_on)
values ('<user>', '<goal id>', '<the run id>', 'waiting_on_date',
        'The applications are in and nothing moves before the info session.',
        'Go to the TA info session.', '2026-10-02');

insert into goals.reviews (user_id, item_id, run_id, verdict, reason, next_move, waits_on_id)
values ('<user>', '<goal id>', '<the run id>', 'waiting_on_goal',
        'The move waits on the pay floor settled under "Land your next role".',
        'Accept the pay floor on that goal.', '<the other goal''s id>');

insert into goals.reviews (user_id, item_id, run_id, verdict, reason, next_move)
values ('<user>', '<goal id>', '<the run id>', 'met',
        'The last loan was paid off on 20 September (the closing statement in Gmail), after autopay went on in June and the card was cleared in August.',
        'Close the goal.');
```

A goal with nothing done in three weeks is also offered for parking on
Today, whatever its verdict: parking keeps its steps and takes it off the
home and out of the runs until the person takes it back up. That offer is
the app's, from what was last done, so there is nothing to write for it.
A parked goal is not in the brief.

One row per goal per run. Rows are never updated: tomorrow's run adds a new
one, and the pages show the newest. The run summary gives the count of each
verdict and names the stalled goals and the met ones.

## A step or phase sent from its row

The person pressed **Send** on one step or one phase on the goal page
(`lib/goals/handover.ts`). The brief names that step first, then its goal,
where it sits, the steps beside it, a phase's own steps, and the collections
the goal fills, and the run row has `job` `step` or `phase` with `item_id` on
the step. The app has already refused a question, a proposal, a step on a goal
that is not approved, and a step Claude is already on, so what you are sent is
yours to work.

The same run starts when the person writes `@dash` on a step asking Claude to
take it ("do this", "draft this for me"; `lib/goals/ask.ts`). Then the brief
also carries what they wrote, under "What they wrote", and what was said on
the row before it, where the links, file names and details the ask leans on
usually are. Treat anything in them about what to produce or how (shorter,
more formal, addressed to someone) as part of the step's done-when. The quick reply has already said in the thread
that the run started, so there is nothing more to write there.

- **A step** (`job` `step`): work that one Claude step as in "The morning
  run", including the next move it leads to (point 5 there), and touch no
  other step. If it turns out to need something only the
  person has, block it with `block_ask` rather than guessing.
- **A phase** (`job` `phase`): work the open Claude steps in it, in order, as
  in "The morning run". Leave the person's own steps and the questions alone.
  The goal is approved, so where the phase plainly needs a Claude step it does
  not have, you may add one under it. Stop at the first step that needs the
  person.

The summary names each step worked and each one left, with the reason.

## A step of yours to prepare

The person pressed **Prepare** on one of their own steps (`kind` `mine`), such
as calling a servicer or sending an application. The run row has `job`
`prepare` and `item_id` on the step, and the brief names it the way a sent
step's brief does. They will do the step; you write what they need to do it.

1. Read the step, its done-when, the steps around it, the goal's collections
   and records, and their email where it bears on it, so what you write names
   the real servicer, account, phone number, site and amounts rather than
   placeholders. Where a fact is not findable, say so in the text and leave a
   clearly marked blank.
2. Write the one form that fits: a draft email ready to send, a call script
   with what to say and what to ask, or numbered step-by-step instructions
   for a site or a form. Keep it to what doing the step needs. When what they
   wrote asks for the work itself rather than help doing it ("review my
   resume", "check my profile"), that work is what you write: the review, with
   what to change and why.
3. Store it in one write, as `claude`:

   ```sql
   set local goals.actor = 'claude';
   set local goals.run_id = '<the run id>';
   update goals.items
   set result = '<what you prepared>', result_url = null
   where id = '<step id>' and user_id = '<user>' and kind = 'mine';
   ```

   `result_url` is for when it also lives somewhere with a link. Change
   nothing else: the step stays `mine` and `open`, and ticking it is theirs.
   Preparing it again replaces the earlier text. Something long, such as a
   full application pack or a month's budget, goes in a file linked from the
   step, as in "The morning run", with the short version in `result`.
   A person to contact or an open role named in it goes to Jobs too, as in
   "People and roles you find go to Jobs".
4. Close the run row with a summary that says what you prepared and anything
   you could not find.

## A Dash step before yours

A step of the person's often goes faster with something written or looked up
first: a cover letter for an application, a shortlist before a round of
calls, a pay range before an offer. When it does, put a `claude` step just
before it that produces that thing, and the morning run works it (plan
#1207). Every run that writes a `mine` step judges it this way, and so does a
mapping run for every open `mine` step on the goal that has not been judged
yet. Each step is judged once.

**The test.** Add a prep step when both hold:

- a draft, research, a shortlist or a list would help the person do the step;
- producing it is one sitting of your work, from what you can read or find.

Examples that get one, from the live goals as they stood before any
research was done on them:

- "Apply to Coinbase's Assistant Controller role": **Draft a cover letter for
  Coinbase's Assistant Controller role**, tailored to the posting.
- "Call three staffing firms", with no list of firms on the goal yet:
  **List staffing firms that place CPAs in New
  York**, with a contact and phone number for each.
- "Know your worth before you say yes", written as a single step: **Research
  the pay range for the roles you are interviewing for**, with sources.
- "Get a pantry": **Shortlist three pantries that fit the kitchen wall**, with
  sizes, prices and links.

Examples that get none:

- "Clear off the couch", "move skis under bed", "Put the rugs down", "Break
  down the empty boxes and mailers": physical work that nothing written would
  speed up.
- "Read the ULURP primer and try explaining it": the reading is the step.
- "Recall last names for Chad, Nicole, Kate and Neil": only the person knows.

Where the line falls is a judgement, so read the step's detail and the steps
around it. "Get and build the bookshelf" goes either way: when the bookshelf
is not chosen yet, a shortlist of models that fit the measured wall helps and
earns a prep step; when it is bought and waiting in its box, building it is
physical and gets none. "Go to the October 7 Land Use committee meeting" gets
one when the agenda is posted and a note on the items would help the person
follow them, and none when it is a first visit just to see the room.

**Never a prep step for:**

- a phase: a `mine` step with sub-steps. Mark it judged and judge its
  sub-steps instead.
- a step already prepared: `result` or `result_url` is set on it, from
  **Prepare** or an earlier run.
- a step a `claude` step beside it already covers, open or done: the staffing
  firm list is already on the goal, so "Call three staffing firms" needs
  nothing more.
- a step whose own `detail` already carries what the prep would produce:
  "Ask Kroll and Hebbia recruiters for base pay" has the question to ask
  written in it.
- a step that is only a send of something already written: "Send the
  fractional offer to George Parkhurst" when the offer is on the goal.
- a step that already has a live prep step: one whose `prepares_id` names it
  and that is neither dropped nor archived. A done one counts, since what it
  produced is the prep. The database allows one live prep step per step.

**A prep step only writes.** It produces a draft or a list and stores it as its `result`, like any `claude` step. Anything that would send,
submit, book or buy stays under "Steps that act outside the plan": a separate
step, proposed with `acts`, after the draft.

**How it goes in.** A `claude` step under the same parent as the person's
step, just before it (the step's `position` minus 1), with `prepares_id` set
to the person's step, and a done-when that names the step it serves. It gets
no row in `goals.dependencies`: the person's step does not wait on it, and
they can do their step without it. Under an approved goal it goes in `open`;
under one that is not approved, `proposed`, as for anything you write there.
The database refuses a `prepares_id` that is not a `mine` step of the same
goal.

**Mark the step judged either way.** Set `prep_checked_at` on the person's
step whether or not you added one. A judged step with no live prep step reads
as needing nothing, and no run judges it again.

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
insert into goals.items (user_id, level, parent_id, kind, title, acceptance,
                         prepares_id, status, position)
values ('<user>', 'step', '<the step''s parent>', 'claude',
        'Draft a cover letter for Coinbase''s Assistant Controller role',
        'A cover letter tailored to the posting is on this step, ready for "Apply to Coinbase''s Assistant Controller role".',
        '<step id>', 'open', <the step''s position minus 1>)
returning id;
update goals.items set prep_checked_at = now()
where id = '<step id>' and user_id = '<user>' and kind = 'mine';

-- steps judged to need nothing
update goals.items set prep_checked_at = now()
where id in ('<step id>', '<step id>') and user_id = '<user>' and kind = 'mine'
  and prep_checked_at is null;

-- the person's steps on a goal not judged yet
with recursive tree as (
  select i.* from goals.items i
  where i.parent_id = '<goal id>' and i.user_id = '<user>' and i.archived_at is null
  union all
  select c.* from goals.items c join tree t on c.parent_id = t.id
  where c.archived_at is null
)
select id, parent_id, title, position, result is not null or result_url is not null as prepared
from tree
where kind = 'mine' and status in ('open', 'blocked') and prep_checked_at is null;
```

A step the person adds on the page is not judged when they add it. It waits
for the next morning run, which judges it with the rest of the day's work.

**The morning list.** The morning brief lists up to ten of the person's
steps not judged yet, newest first (`lib/goals/prep-candidates.ts`): open
`mine` steps with nothing open beneath them, a start date that has come, no
`result` and no live prep step. Judge each one it lists, whichever way it
goes, and set `prep_checked_at` on every one. The steps that were open before
this list existed work through it over the first mornings. A step the brief
lists as untouched for a week is left off, since preparing it is one of the
moves that section offers.

Name each prep step added in the run summary, with the step it serves, and
give the count of steps judged to need nothing.

## The weekly run

Once a week the daily cron fires the routine with the `goals.runs` row it
wrote with `job` `weekly` (`inngest/goals/weekly.ts`). It researches the
help the goals ask for, then leaves a note on every open goal. It writes no
verdicts: each goal's status is the morning run's ("Reviewing each goal").

### Researching the help each goal asks for

The brief then lists each open goal that asks for weekly help, with the kinds
it asks for from `goals.items.help_kinds` and the note on each ("Brooklyn,
weeknights"), and the goal's live rhythms. A goal that asks for nothing gets
nothing, whatever rhythms it has. A week when no goal asks for help is a
review and nothing else.

Under that, the brief lists every suggestion from the last eight weeks,
grouped by kind, with what the person did with it: `going`, `not_for_me`,
`ignored` (no answer within the week), and whether they then went. Read
those lines before searching. They are the only feedback there is, and each
kind's research should visibly follow its own lines: more like what was
marked going or attended, less like what was turned down or left
unanswered. A reaction to a talk says nothing about what to read, so do not
carry one kind's reactions over to another. You can read further back
yourself:

```sql
select kind, title, source, place, happens_on, reaction, attended, created_at
from goals.suggestions
where user_id = '<user>'
order by created_at desc limit 200;
```

Work one kind at a time, for every goal that asks for it, using the note as
the brief for what to look for. Each kind has its own sources and its own
rule for dates:

- **events**: talks, meetups, performances and classes in New York City in
  the coming seven to ten days. Eventbrite, Meetup, museum and library
  calendars (NYPL, Brooklyn Public Library, Queens Public Library), NYC Parks
  and org newsletters. Every one needs `happens_on`, and `starts_at` when
  the time is known, in New York time with its offset.
- **volunteering**: openings in New York City the person could sign up for
  now. NYC Service, VolunteerMatch, Idealist, New York Cares and the
  organisations' own pages. An opening with no single date takes the first
  date it can be done as `happens_on`.
- **reading**: books, long articles and papers that fit the goal and the
  note. Publishers' pages, library catalogues, the authors' own sites and
  reviews in the major papers. Link the thing itself, or its library or
  publisher page. No date: leave `happens_on` null. When the person's Learn
  module is the better home for it, say so in `detail`.
- **courses**: courses and workshops open for enrolment, in person in New
  York City or online. University extension schools, the libraries' free
  classes, Coursera, edX and the organisers' pages. `happens_on` is the
  start date, or null for one taken at your own pace.
- **job_leads**: open roles that fit the goal and the note. Company career
  pages and the job boards the note names. `happens_on` is the closing date
  when there is one, else null, and `place` is where the role is based. The
  Jobs module tracks applications, so a lead is a pointer to a role, not an
  application. Each lead with a link is copied to the Roles page's
  recommended roles as it is written (`goals` 0055), so write it here only.

Then write the finds:

1. Two to five suggestions per kind asked for, and no more than twelve in
   the run. Check each find is current and has a page of its own you can
   link as `url`.
2. One row each, with `kind` set to the kind it answers. `item_id` is the
   goal it is for, or the rhythm it counts towards when it is an event or a
   volunteer opening for a goal with a live rhythm. `run_id` is this run. The
   database refuses a row with no kind or a kind outside the five.

   ```sql
   set local goals.actor = 'claude';
   set local goals.run_id = '<the run id>';
   insert into goals.suggestions
     (user_id, item_id, run_id, kind, title, detail, url, place, source, happens_on, starts_at)
   values
     ('<user>', '<rhythm id>', '<the run id>', 'events', 'Talk: …',
      'One or two plain sentences on why it fits.', 'https://…',
      'Brooklyn Public Library, Central', 'BPL events', '2026-10-01', '2026-10-01T18:30:00-04:00'),
     ('<user>', '<goal id>', '<the run id>', 'reading', 'The Power Broker, Robert Caro',
      'Why it fits the note.', 'https://…', null, 'Penguin Random House', null, null);
   ```

3. Do not repeat a suggestion already in the table, and do not suggest
   something that has already happened or closed.

Never write `reaction`, `reacted_at` or `attended`. Going and not for me are
the person's buttons on the Goals home, whether they went is their tick on
Todo, and marking the unanswered ones ignored is done by the cron. The guard
(`goals` 0008) refuses a Claude write to any of them. The summary says how
many suggestions you wrote of each kind, and what in each kind's past
reactions you followed.

### The week's notes

After the research, leave a note on every open goal and one for the Goals
home ("Leaving a note"), reading each goal's newest status in
`goals.reviews`. The weekly run is the one run that writes a note on every
goal, so these are the notes the person reads most.

Where a goal's files hold figures that have moved since they were written
(the applications breakdown, a debt plan's balances), revise those files with
the new figures and a `change_note`, and say so in the goal's note.

## Flagging something on a goal

Sometimes a run finds a thing the person should know that is neither a step
nor a question with options: the servicer moved the due date, a statement
shows a missed payment, a deadline in an email is sooner than the step says.
Do not bury it in the run summary, which is only read by opening the run.
Flag it. A flag shows on the Goals home under Waiting on you and on the
goal's page, where the person answers it or puts it aside.

A flag is a row in `public.raised_items`, not in the goals schema, with the
goal's id and module `goals`. The goal must be a goal, not a step: use the
id of the goal the step is under, and name the step in the detail. There is
no history trigger here, so no actor or run settings are needed.

```sql
insert into public.raised_items (user_id, module, goal_id, title, detail, ask, source)
values ('<user>', 'goals', '<goal id>',
        '<what happened, in one line: Nelnet moved your due date to the 28th>',
        '<where you saw it and what it changes: the September statement; autopay still runs on the 15th>',
        '<what you want from them, if anything: Move autopay to the 28th?>',
        'goals run <run id>')
returning id;
```

`title` is up to 200 characters, `detail` up to 4,000, `ask` up to 500 and
may be left null when there is nothing to decide. Flag each thing once:
read the goal's open flags first (`status in ('open', 'answered')` with the
same `goal_id`) and skip one already there. Keep flags for things that
happened; what the person has to do is a step, and a choice between paths is
a question step.

When the person answers, the app fires this routine with job `raise`. The
brief names the flag, what has been said on it and their answer. Do what the
answer says, within "What you may change", then write your reply into the
flag's thread and close it with what came of it. The brief spells out both
writes. Leave it open, and say so in the reply, if what the answer asked for
is still outstanding.

## Replying to a comment

A comment tagged `@dash` on a goal or a step is answered by a quick model call
in the app. When that call cannot do it from the goal alone (research, email,
changing steps), it fires this routine on the goal with the comment in the
brief: which goal or step it is on, the thread so far, and the insert that
puts your reply in `goals.comments`.

- A question is answered, and only answered. Write one reply and stop.
- An instruction is carried out inside "What you may change", then reported
  in the thread. Anything outside those rules, or anything that is the
  person's move (answering a question, approving, closing or dropping a step
  of theirs, deleting), is not done; say so in the reply and where on the page
  they do it.
- Work you can do that a step of theirs describes ("review my resume and
  LinkedIn", "you do this instead of me") is an instruction, never their move.
  The quick reply passes it on when the step is a phase with nothing of
  Claude's in it. Add a Claude step under that phase for the work (for example
  "Review your resume and LinkedIn profile"), with the links and file names
  from the thread in its detail, work it in this run as in "The morning run",
  and store what it produced on it. Leave their steps as they are. Where their
  done-when names someone else ("one outside review"), ask in the reply whether
  your pass counts toward it rather than changing it.
- A page you cannot read (a LinkedIn profile behind its login, a file not
  shared with the account) is said plainly in the reply with what would work
  instead, such as the profile saved as a PDF (More, then Save to PDF, on the
  profile) and put in their Drive.
- Facts the comment gives for a collection are filed as drafts, with
  `source = 'comment'` and `source_ref` the comment's id, for the person to
  confirm on the step. Never confirm one.
- Write the reply with `author = 'claude'`, in the same call as the actor and
  run settings. The database refuses a Claude write of any other author, and
  refuses Claude deleting a comment the person wrote.

Close the run row as for any other run; the summary says what you replied and
what you changed.

## Files

A file is a piece of writing kept as its own page (`core.files`, opened at
`/goals/files/<id>`), for anything too long for a step's result or worth
coming back to: a breakdown of their data, research, a comparison, a plan, a
draft. What goes in one is in `reference/files.md`; read it before you write
your first file in a run. Files are in the `core` schema, which has no actor
setting: `made_by = 'claude'` is what marks a file as yours.

Write it, link it from the step that asked for it, and link it from the goal
when it bears on the goal as a whole, in one call:

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
with file as (
  insert into core.files (user_id, title, summary, body, made_by, origin)
  values ('<user>', 'Your applications by role family',
          'FP&A and accounting answer and interview best; strategic finance is 43% of the volume at average conversion.',
          '<the markdown>', 'claude', 'goals.items:<step id>')
  returning id
)
insert into goals.links (user_id, item_id, kind, target_id)
select '<user>', item_id, 'file', file.id
from file, (values ('<step id>'::uuid), ('<goal id>'::uuid)) as items(item_id)
returning target_id;
```

- `title` says what it is about, in the person's words, up to 200 characters.
- `summary` is the answer in one or two sentences (up to 600 characters). It
  shows under the title wherever the file is listed.
- `origin` is `goals.items:<id>` of the step that asked for it, or of the goal
  when no one step did.
- Link a step to its file with `goals.links` as above. The step's result then
  ends with the link as markdown: `[Read the file](/goals/files/<id>)`.

**Revising.** Update the row. The database numbers the new version and keeps
the old one; you never write `version` or `core.file_versions`. Set
`change_note` in the same update to one sentence on what changed.

Read the file's thread first. Comments the person wrote on it are in
`core.file_comments` (`select author, body, created_at from core.file_comments
where file_id = '<file id>' order by created_at`), and what they ask for there
is what this revision does. A file with comments newer than its `updated_at`
is waiting on a revision: make it when the step it serves is next worked, and
name the comment in `change_note`.

```sql
update core.files
set body = '<the new markdown>', summary = '<the new answer>',
    change_note = 'Added the October applications; FP&A reply rate is now 61%.'
where id = '<file id>' and user_id = '<user>';
```

Never delete a file. One that no longer applies gets `archived_at = now()`,
and only when the person asked or the step it served was dropped.

## Leaving a note

Each goal's page opens with a box headed "Where it stands", and the Goals
home opens with one headed "From Claude". The words in both are a note you
leave in `goals.briefs` as a run finishes. The pages list what is waiting on
the person themselves, row by row; the note is your reading of it: what
moved, what matters now, and what you will do next.

**When.** Every run that worked on a goal (a goal run, a re-shape, a sent step
or phase, a prepared step, a flag answered) leaves one note on that goal. The
morning run leaves one on each goal whose steps it worked, and on each goal
with a step under way it nudged or offered for closing. The weekly run
leaves one on every open goal. The morning and weekly runs also leave one note
for the home, with no `item_id`, covering every goal.

**What.** A few lines of markdown, up to 2,000 characters, and usually under
600. Write it for someone glancing at the top of the page:

- Where the goal stands against its done-when, with the figure when there is
  one ("Balance is $18,250, down $1,400 this month").
- What changed since the last note: what you did, what they did, what came in.
  Link a file you wrote or revised.
- What is waiting on them, most important first, by name ("Answer *Which lane
  first?*; it decides the next three steps"). Do not list everything: the box
  lists it underneath.
- What you will do next, if anything is lined up.

The home's note does the same across all goals in three to six lines: the one
or two things most worth their attention today, and anything that went wrong
(a failed step, a due date that moved). Name goals by their titles.

Plain sentences, the person as "you", no heading, no sign-off, and nothing
repeated from the goal's own title or done-when. Write to
docs/WRITING-GUIDE.md.

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
insert into goals.briefs (user_id, item_id, run_id, body)
values ('<user>', '<goal id>', '<the run id>', '<the note>');

-- the home's note
insert into goals.briefs (user_id, item_id, run_id, body)
values ('<user>', null, '<the run id>', '<the note>');
```

Rows are never updated: the page shows the newest, and the older ones are the
record.

## Stopping

This routine writes rows and nothing else: there is no code to change and
nothing to commit. Close the run row, then end with the same summary in your
reply.

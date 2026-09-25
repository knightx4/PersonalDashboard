---
name: goals
description: Work the person's life goals in the goals schema — the tree of areas, goals and steps on /goals. Pulling in - before mapping, search the other modules through the catalogue (job search thoughts, vault notes, Learn aims, applications) and keep what bears on the goal as context. Planning an area - propose the goals an area needs when the person knows the direction but not the goals, each with a done-when and a first move. Mapping - lay out the whole path for a goal from the first run: phases with sub-steps, Claude steps wherever Claude can do the work, information steps with a collection definition pre-filled as drafts from Gmail, provisional steps for what hangs on a question, and questions with lettered options, and the kinds of weekly help that fit the goal as a proposal on its page. Re-shaping - read the answers to those questions and settle the provisional steps. After the person approves a goal, add, split and reorder its steps without asking. Morning run - work the ready Claude steps and store what each produced on the step. Weekly run - give each open goal a verdict (on track, stalled or waiting on you) with the next move, proposing that move as a step for a stalled goal, then research the help each goal asks for (events, volunteer openings, reading, courses, job leads) and write it as suggestions tagged with their kind, following past reactions to each kind. Flagging - put what a run finds that the person should know (a moved due date, a missed payment) under Waiting on you on the goal, and act on their answer. Use when the goals routine is fired from "Plan this area" on an area, from "Work on this" on a goal, by the morning run or by the weekly run, or the user says "plan my <area> area", "what goals should I have for …", "shape my goal …", "break down <goal>", "work on my goals".
---

# Working a goal

Goals is the person's own workspace at `/goals`: areas (money, career, the
city), goals under them, and a tree of steps under each goal. The spec is
`docs/GOALS-SPEC.md`; read "The three levels", "Fog and refining a goal",
"Approval" and "Second round: making it useful" before your first write.

Your part is the map: the whole path from where the person is to the goal's
done-when, with every step on it that you can see. You do the steps you can
do, you gather the facts you can find, and you ask only the questions whose
answers change the path.

## How you read and write

Through the **Supabase** connector (`mcp__Supabase__execute_sql`, loaded with
ToolSearch), project `asjztutnqxbecruvyrbj`. Every table is in the `goals`
schema. Filter every read and write by the `user_id` in your brief.

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
       dismissed_at, collection_id, asks_for, questions, position, due_on, rhythm_count,
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
goal tied to Learn or the job search, the comments on the goal and its steps
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

A goal is **not approved** while `approved_at` is null. Everything you write
under it goes in `proposed`, except a question, which goes in `open`. Once the
goal is approved, what you write goes in `open`, except a provisional step,
which stays `proposed` (below). Before you add anything, read what is already
there and build around it: keep the person's steps, fill in what is missing,
and reuse a step that already says what you were about to write.

### Phases and sub-steps

1. **Phases at the top level.** Three to six steps under the goal, in the
   order they happen, each a stage of the path: for a debt goal, get the
   numbers, choose the order, build the schedule, set up the payments, keep it
   on track. A phase has `kind = 'mine'`, an `acceptance` saying what is true
   when the stage is over, and sub-steps. It reads Waiting while its sub-steps
   are open, and comes up for the person to tick off once they are done.
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

### Information steps

A step that needs facts from the person (balances, rates, dates, account
names) is an information step: it points at a **collection**, and the page
draws a form or a table from the collection's fields. "List your loan
balances" with nowhere to list them is the gap these close.

1. **Reuse before you define.** Read the account's collections (the query
   above). If one already holds these facts, use it: serve it to this goal
   and, if it lacks a field you need, add the field. Make a new collection
   only when none fits. Names are one per account, case-insensitive, so
   "loans" means one thing.
2. **Define it from the field types.** You never write a table or a
   migration; a collection is a row. `shape` is `list` for one row per thing
   (loans, accounts) and `one` for a single set of facts (a budget, a
   profile). Each field is `{"key", "label", "type"}` with, where it applies,
   `"tracked": true` or `"options": [...]`:

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
3. **Serve it to the goal and point the step at it.** `asks_for` lists the
   field keys the step needs; leave it null when it needs every field.
   `questions` lists what the step has to answer, in order, as
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
    {"key": "name", "label": "Loan", "type": "text"},
    {"key": "servicer", "label": "Servicer", "type": "text"},
    {"key": "kind", "label": "Federal or private", "type": "choice", "options": ["Federal", "Private"]},
    {"key": "balance", "label": "Balance", "type": "money", "tracked": true},
    {"key": "rate", "label": "Interest rate", "type": "percent"},
    {"key": "minimum", "label": "Minimum payment", "type": "money"},
    {"key": "due_day", "label": "Due day", "type": "day_of_month"}
  ]'::jsonb)
  returning id
), served as (
  insert into goals.collection_goals (user_id, collection_id, goal_id)
  select '<user>', id, '<goal id>' from c
)
insert into goals.items (user_id, level, parent_id, kind, title, acceptance,
                         collection_id, asks_for, questions, status, position)
select '<user>', 'step', '<phase id>', 'mine',
       'Every loan listed with balance, rate and minimum',
       'Each loan has a confirmed row with its balance, rate and minimum payment.',
       id, array['name', 'balance', 'rate', 'minimum'],
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

### Pre-filling from Gmail

When you write or find an information step, search the person's Gmail through
the **Gmail** connector (load its tools with ToolSearch) for what would fill
it: loan statements, servicer notices, offer letters, receipts, bills. Read
the messages you find, and write what they say as **draft** records, one per
thing, with the message named:

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
insert into goals.records (user_id, collection_id, data, draft, source, source_ref, position)
values ('<user>', '<collection id>',
        '{"name": "Direct Loan, subsidized", "servicer": "Nelnet", "balance": 12480.22,
          "rate": 4.99, "minimum": 132.00, "due_day": 21}'::jsonb,
        true, 'gmail', '<the Gmail message id>', 10);
```

- `source_ref` is the message's id as the connector gives it. The page turns
  it into a link to that email beside the draft.
- Values are stored in the forms in the table above. Leave out a value you
  did not find; do not guess one. Use the newest statement for each loan.
- Check what is already there first. A loan that already has a row gets no
  second draft; if a newer email shows a changed balance, say so in the run
  summary rather than writing over what the person confirmed.
- Every record you write is a draft. The database refuses a record from you
  that is not, and refuses you confirming one. Confirming is the person's
  press on the step.
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
- Read the figures the way the step's notes explain them, not by the field
  name alone: a Grad PLUS "repayment begin date" is its last disbursement,
  and the first payment is the next due date.

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

### Questions

Ask only where the answer changes the path, and ask each one once. A question
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
provisional**: `status = 'proposed'`, with a `detail` that opens with the line

```
Provisional: depends on "<the question's title>".
```

and then the step as you would write it for the answer you recommend. A
provisional step stays out of the morning run and the progress bar, and shows
its approve and turn-down buttons: the person can take it as it stands. Put it
where it belongs on the path, not under the question.

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

1. **Get the numbers** (phase): the loans information step, pointed at the
   `loans` collection and pre-filled from servicer emails; a `claude` step
   checking the drafts against the servicer's own figures once confirmed.
2. **Choose the payoff order** (phase): the question "Avalanche or
   snowball?" with lettered options; a `claude` step checking whether
   refinancing, income-driven repayment or forgiveness applies to these
   loans.
3. **Build the schedule** (phase): a `claude` step for the month-by-month
   schedule and payoff date, provisional on the order question.
4. **Set up the payments** (phase): autopay on each loan (yours), with the
   extra payment going to the first loan in the order.
5. **Keep it on track** (phase): a monthly `rhythm` to log each balance, and a
   quarterly `claude` review of progress against the schedule.

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
   a network". Where a goal is a practice rather than something that ends,
   say so in the done-when ("kept for eight of the last ten weeks") and make
   its first step a `rhythm`.
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
answers. A question that changes one goal's shape goes under that goal as a
`decision` step with lettered options, as in "Questions". Where you cannot
write a goal's done-when even provisionally, write it with `fog` instead.

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
2. **Go to one urbanism event a week**: a practice, kept for eight of ten
   weeks. First move: a `rhythm` of one event a week, which the weekly run
   feeds with events.
3. **Be a regular at your community board**: as in the example above.
4. **Volunteer steadily with one advocacy group**: done when you have put in
   ten sessions with one of Open Plans, Transportation Alternatives, Open New
   York or the like. First move: a `claude` step comparing three groups'
   volunteer asks.
5. **Know ten people in the scene by name**: done when ten people working on
   housing, transit or planning would recognise you. First move: yours, write
   down the three you already know.
6. **Put something of your own into the conversation**: a testimony, an
   op-ed, a map or a talk, published or given. Written with `fog` if the
   person has not said what they would want to make.

### Afterwards

Change nothing on the area itself: its name and note are the person's. Do not
edit, drop or archive a goal of theirs. The summary lists each goal proposed
with its first move, any question asked, and which directions you left alone
because an existing goal covers them. The person approves each goal on its own
page, and **Work on this** there maps it.

## Re-shaping after answers

When questions under the goal have a `resolution`:

- Settle the provisional steps that hung on each answer. One the answer bears
  out loses its `Provisional:` line and goes to `open` if the goal is approved
  (it stays `proposed` if not). One the answer changes is rewritten to fit.
  One the answer made pointless is dropped (`status = 'dropped'`).
- Write any new steps the answer made clear, in the phase they belong to.
- Update or clear the goal's `fog`.
- Ask a new question only if an answer opened one. Never re-ask one the person
  answered, or one they put aside.
- A provisional step the person already approved (it is `open` with the
  `Provisional:` line still there) is theirs now: rewrite it to fit the
  answer and take the line off, but do not drop it; if the answer makes it
  pointless, ask whether to drop it as a question.

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
- Write anything new as a proposal (`proposed`), whether or not the goal is
  approved, so the person approves it from the page.
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

**After it is approved:** add steps as `open` (provisional ones as
`proposed`), split one into sub-steps, move a step under another step of the
same goal, reorder by `position`, point a step at a collection, make a step
wait on another, and block a step on the person (see "Blocked and waiting
steps"). Do these without asking.

**Collections, approved or not:** define one, add fields to one, serve one to
the goal, and write draft records into one. Never confirm a record, and never
archive one the person confirmed.

**Never, approved or not:** add a goal except as a proposal; change a goal's
`acceptance` (its done-when); close, drop or archive a goal; drop or archive a
`mine` or `rhythm` step; answer a question; approve anything. When one of these
seems right, ask it as a question step instead, with the change you would make
as option A.

Nothing is deleted. Archive with `archived_at = now()` where you are allowed
to, and delete only a row you wrote by mistake in this same run.

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

## The morning run

The daily cron fires the routine each morning when a `claude` step is ready,
or when an information step has an answer out of date
(`inngest/goals/daily.ts`), with a brief listing those steps and the
`goals.runs` row it wrote with `job` `daily`. Work only the steps it names.
Before each one, report it on the run row with `now_on` the step's title
("Reporting progress"). For each one:

1. Read the step, its goal and the steps around it, as in "Reading the goal".
   The title and `acceptance` say what to produce; the goal says what it is
   for.
2. Produce it: a research note, a draft, a list. Write it for the person to
   read on a phone: plain words, the answer first, sources as links where
   you used any. Use web search where the step needs current facts.
3. Store it on the step and close the step in one write. `result` is the text
   itself (up to 100,000 characters). `result_url` is optional, for when it
   also lives at a link. Only a `claude` step takes either here; a step of
   the person's takes them only when it is prepared ("A step of yours to
   prepare").

   ```sql
   set local goals.actor = 'claude';
   set local goals.run_id = '<the run id>';
   update goals.items
   set result = '<what you produced>', result_url = null, status = 'done'
   where id = '<step id>' and user_id = '<user>' and kind = 'claude';
   ```

The home then lists the step under "Waiting on you" until the person presses
**Mark read**. Never write `reviewed_at`: reading it is theirs, and the guard
refuses it.

A step you cannot finish because it needs something only the person has is
blocked on them, with `block_ask` saying what (see "Blocked and waiting
steps"). One whose facts are not findable stays open with no result. Say why
in the run summary either way, and where a choice would unblock it, add it as
a question step under the same goal. The summary names each step worked and
each one left.

An information step the brief lists under "answers out of date" is not a
`claude` step and gets no `result`. Work its listed answers again as in
"Answers on an information step", leave its status alone, and name each
answer rewritten or confirmed in the summary.

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
also carries what they wrote, under "What they wrote". Treat anything in it
about what to produce or how (shorter, more formal, addressed to someone) as
part of the step's done-when. The quick reply has already said in the thread
that the run started, so there is nothing more to write there.

- **A step** (`job` `step`): work that one Claude step as in "The morning
  run", and touch no other step. If it turns out to need something only the
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
   for a site or a form. Keep it to what doing the step needs.
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
   Preparing it again replaces the earlier text.
4. Close the run row with a summary that says what you prepared and anything
   you could not find.

## The weekly run

Once a week the daily cron fires the routine with the `goals.runs` row it
wrote with `job` `weekly` (`inngest/goals/weekly.ts`). The run does two
things, in this order: it reviews every open goal, then it researches the
help the goals ask for.

While reviewing, look for what is new since the last weekly run (rows with
`created_at` or `updated_at` after it) in the sources each goal draws on: the tables its kept context comes from, and the
`intent` sources in the catalogue. A new thoughts entry or a vault note
written this week can change a goal's next move. Write what matters as
context, proposed, and say so in the verdict's reason.

### Reviewing each goal

The brief lists every open goal with its done-when, when anything was last
done on it (a step closed as done, or a reading logged), and last week's
verdict when there was one. Read each goal's tree before judging it: what is
done, what is open, what waits on the person, and what waits on you.

Give every open goal one verdict:

- **on_track**: it is moving towards its done-when at a pace that gets there.
- **stalled**: nothing is moving and nobody is on it. **A goal with nothing
  done in three weeks is stalled**, and the brief says so on that goal's
  line. That holds even when a question of theirs is what it waits on: say
  so in the reason.
- **waiting_on_you**: the next thing is the person's, such as a question to
  answer, a breakdown to approve or a step of theirs, and something was done
  in the last three weeks.

Write one sentence on why and one on the next move. Both are read on the
goal's card on the Goals home, so name the step or the question rather than
describing the goal back to them.

A stalled goal also gets its next move as a step under it, with status
`proposed`, so it lands in the person's breakdown to approve. Make it the
smallest thing that would get the goal moving, `mine` or `claude` as fits,
with a done-when. Do not propose one when an open proposal under the goal
already says the same thing: name that one instead. The database refuses a
stalled review with no `step_id`.

```sql
set local goals.actor = 'claude';
set local goals.run_id = '<the run id>';
with step as (
  insert into goals.items (user_id, level, parent_id, kind, title, acceptance, status, position)
  values ('<user>', 'step', '<goal id>', 'mine', 'Call the lender about the rate',
          'The new rate is written on the goal.', 'proposed', 5)
  returning id
)
insert into goals.reviews (user_id, item_id, run_id, verdict, reason, next_move, step_id)
select '<user>', '<goal id>', '<the run id>', 'stalled',
       'Nothing has been done since the balance was logged on 2 September.',
       'Call the lender about the rate, proposed as a step.', id
from step;

-- on_track and waiting_on_you carry no step
insert into goals.reviews (user_id, item_id, run_id, verdict, reason, next_move)
values ('<user>', '<goal id>', '<the run id>', 'waiting_on_you',
        'Two sub-steps closed this week and the next one is yours.',
        'Answer "Which card first?" on the goal.');
```

One row per goal per run. Rows are never updated: next week's run adds a new
one, and the card shows the newest. The summary gives the count of each
verdict and names the stalled goals.

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
  when there is one, else null. The Jobs module tracks applications, so a
  lead is a pointer to a role, not an application.

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
many verdicts of each kind you wrote and which goals are stalled, how many
suggestions you wrote of each kind, and what in each kind's past reactions
you followed.

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
- Facts the comment gives for a collection are filed as drafts, with
  `source = 'comment'` and `source_ref` the comment's id, for the person to
  confirm on the step. Never confirm one.
- Write the reply with `author = 'claude'`, in the same call as the actor and
  run settings. The database refuses a Claude write of any other author, and
  refuses Claude deleting a comment the person wrote.

Close the run row as for any other run; the summary says what you replied and
what you changed.

## Stopping

This routine writes rows and nothing else: there is no code to change and
nothing to commit. Close the run row, then end with the same summary in your
reply.

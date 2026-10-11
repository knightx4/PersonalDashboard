# Mapping a goal

Part of the goals skill. Read [../SKILL.md](../SKILL.md) first: it has how
every write is labelled, the run row, what you may change, and the index
saying which file holds each section named here.

"Ask Dash" on a goal asks for the whole map, on the first run and on every run
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
  When the practice already leaves a record in the app, set where its count
  is read from so the person never has to log it: `count_source =
  'applications'` for sending job applications (counted from Jobs), or
  `count_source = 'calendar'` with `count_match` for attending something that
  goes on their calendar. `count_match` is text the event title contains,
  ignoring case, with alternatives separated by `|`
  (`urbanism|community board`); look at the titles in `todo.feed_events` and
  `todo.events` first and write it only when real events would match. Leave
  both null for anything else, posts on X included. A rhythm with a source is
  counted by the sync, so never count towards it yourself.
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

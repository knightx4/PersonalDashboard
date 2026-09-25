---
name: goals
description: Work the person's life goals in the goals schema — the tree of areas, goals and steps on /goals. Mapping - lay out the whole path for a goal from the first run: phases with sub-steps, Claude steps wherever Claude can do the work, information steps with a collection definition pre-filled as drafts from Gmail, provisional steps for what hangs on a question, and questions with lettered options. Re-shaping - read the answers to those questions and settle the provisional steps. After the person approves a goal, add, split and reorder its steps without asking. Morning run - work the ready Claude steps and store what each produced on the step. Weekly run - give each open goal a verdict (on track, stalled or waiting on you) with the next move, proposing that move as a step for a stalled goal, then research the help each goal asks for (events, volunteer openings, reading, courses, job leads) and write it as suggestions tagged with their kind, following past reactions to each kind. Use when the goals routine is fired from "Work on this" on a goal, by the morning run or by the weekly run, or the user says "shape my goal …", "break down <goal>", "work on my goals".
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

- Fired from **Work on this**, by the **morning run**, by the weekly run,
  after the person answered questions on a goal (job `reshape`), or by
  **Send** on one step or phase (job `step` or `phase`), or by **Prepare** on
  one step of the person's (job `prepare`): the app has written the row as
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
       dismissed_at, collection_id, asks_for, position, due_on, rhythm_count,
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
   field keys the step needs; leave it null when it needs every field. The
   step closes itself once the collection holds what it asks for.

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
                         collection_id, asks_for, status, position)
select '<user>', 'step', '<phase id>', 'mine',
       'Every loan listed with balance, rate and minimum',
       'Each loan has a confirmed row with its balance, rate and minimum payment.',
       id, array['name', 'balance', 'rate', 'minimum'], 'open', 10
from c
returning id, collection_id;
```

An existing step that already asks for these facts (say "List your loan
balances, rates and minimum payments") is pointed at the collection with an
update of `collection_id` and `asks_for`, rather than written again.

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

The daily cron fires the routine each morning when a `claude` step is ready
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

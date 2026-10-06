# The morning run

Part of the goals skill. Read [../SKILL.md](../SKILL.md) first: it has how
every write is labelled, the run row, what you may change, and the index
saying which file holds each section named here.

## The week's focus

Each week the person picks the two or three goals they are pushing:
`goals.items.focus` on a goal (docs/GOALS-SPEC.md, "The week's focus").

- **You never set or clear focus**, on any goal, and never propose it as a
  step. The database refuses the write from you. Choosing what to push is
  theirs; when you think a goal should be in focus, say so in a note.
- **Work focus goals first.** The morning brief lists their ready steps first
  and marks each "one of this week's focus goals"; work them in that order,
  and reach other goals' steps only with the time left. An errand due within
  seven days counts as in focus.
- **Lead with the focus goals** in the home's note and the morning brief's
  summary: how each moved and what is next on it, then the rest briefly.
- Everything else covers every open goal as before: closing steps from
  evidence, reading statements, and each goal's daily verdict.
- While no goal has focus, every goal counts, and none of this changes
  anything.

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

# Tending the person's steps

Part of the goals skill. Read [../SKILL.md](../SKILL.md) first: it has how
every write is labelled, the run row, what you may change, and the index
saying which file holds each section named here.

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

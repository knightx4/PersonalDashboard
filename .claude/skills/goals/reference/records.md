# Filing records and answers

Part of the goals skill. Read [../SKILL.md](../SKILL.md) first: it has how
every write is labelled, the run row, what you may change, and the index
saying which file holds each section named here.

## Filing a document you were given

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

## Pre-filling from Gmail

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

## Answers on an information step

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

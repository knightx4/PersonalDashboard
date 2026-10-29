---
name: dash-questions
description: Write up to five new questions about the person into you.dash_questions for the Answer tab of You. Read the run row, every question already asked (open, answered and skipped) and every answer, where they are now, their details, goals, recent notes and insights, then write questions their records cannot answer, each with a sentence on why it helps, none a repeat of one already asked. Use when the goals routine is fired with a brief that starts "Follow .claude/skills/dash-questions/SKILL.md" and names "Question run <id>" (the Ask button on the Answer tab), or the user says "ask me some questions about myself".
---

# Writing Dash's questions about the person

The Answer tab of You shows questions Dash has asked about the person. They
answer or skip each one, and the answers become part of what Dash reads when
it answers them or works on their goals (`core.memory_sources`, the
`you.dash_questions` source). A good question asks for something the records
cannot tell Dash and that would change how it helps: a preference, a reason,
a priority, what a word they use means to them.

**You change rows, not code.** Do not commit or push. Do not send email,
post, or contact anyone. Do not delete anything.

In anything the person reads, the assistant is **Dash**. Never write
"Claude" in a question, a why or the summary. Write to
`docs/WRITING-GUIDE.md`: plain sentences, no slogans, no "not X, it's Y", no
em dashes for rhythm.

## Checklist

1. **Read the brief and claim the run**: stop if the row is missing or already finished.
2. **Read every question already asked**: open, answered and skipped, with the answers.
3. **Read about them**: where they are now, their details, goals, recent notes, insights and their marks.
4. **Write at most five questions**, each one their records cannot answer, each with why, none a repeat or a near repeat of one already asked.
5. **Finish the run** with a one-sentence summary, or mark it failed with a reason they can act on.

## How you read and write

Through `npx tsx scripts/sql.ts` (CLAUDE.md, "Rows are written through
scripts/sql.ts"), not the Supabase connector, whose confirmations never
reach a routine. Filter every read and every write by the `user_id` in your
brief. You are writing as the service role, so row level security does not
stop you touching another account's rows; the filter is the only thing that
does. For a long statement, write it to a file in your scratchpad and send
it with `--file`, so apostrophes need no shell escaping. The script takes
one statement per call, so send each statement in a block below on its own.

## 1. Read the brief and claim the run

The Ask button on the Answer tab fires the goals routine with this brief
(`dashQuestionsBrief` in `lib/you/dash-questions-run.ts`):

```
Follow .claude/skills/dash-questions/SKILL.md
Question run <run id>
user_id <uuid>
```

```sql
select id, status, requested_at from you.dash_question_runs
where id = '<run id>' and user_id = '<user_id>';
```

If the row is missing, or its status is `ready` or `failed`, stop: it has
been handled. Otherwise mark it started:

```sql
update you.dash_question_runs set status = 'running', started_at = now(), error = null
where id = '<run id>' and user_id = '<user_id>';
```

The tab shows the run as going while it is queued or running, and reads it
as stopped after ninety minutes, so this run is short: read, write, finish.

## 2. Read every question already asked

```sql
select question, why, status, answer, answered_at, skipped_at, created_at
from you.dash_questions
where user_id = '<user_id>'
order by created_at;
```

Every question here, whatever its status, is off limits as a new question:

- **Answered**: Dash knows the answer. Ask a follow-up only when the answer
  opened something new, and word it as the follow-up it is.
- **Skipped**: they chose not to answer. Do not ask it again in other words,
  and do not ask more on the same subject in this run.
- **Open**: still waiting. Count them: if five or more are open, write none,
  finish the run with a summary saying so, and stop. Otherwise write at most
  five, and fewer when the open ones already cover what you would ask.

## 3. Read about them

Read enough to know what the records already say, so no question asks for
something Dash could look up.

```sql
-- where they are now, in their words; it outranks any older note
select body, updated_at from you.now where user_id = '<user_id>';

-- their details (name, contact, title); never ask about the race, gender
-- or sexuality columns
select full_name, title, custom_fields from you.details where user_id = '<user_id>';

-- where they have lived, worked and studied
select name, city, country, moved_in, moved_out from you.places where user_id = '<user_id>' order by moved_in desc nulls first;
select employer, title, started, ended from you.work_history where user_id = '<user_id>' order by position;
select kind, name, detail, started, ended from you.profile_entries where user_id = '<user_id>' order by position;

-- their open goals
select id, title, detail, due_on from goals.items
where user_id = '<user_id>' and level = 'goal' and status = 'open' and archived_at is null
order by created_at;

-- the insights Dash wrote, with their marks; a card marked wrong or not
-- quite is a good place to ask what Dash got wrong
select i.claim, i.question, i.answer, v.verdict, v.note
from you.insights i left join you.insight_verdicts v on v.insight_id = i.id and v.user_id = i.user_id
where i.user_id = '<user_id>' and i.status = 'shown'
order by i.created_at desc limit 15;

-- the notes they wrote most recently, newest first; read the ones that
-- matter in full
select path, title, first_written_at, left(body, 600) as opening
from obsidian.notes
where user_id = '<user_id>' and deleted_at is null
  and path !~* 'password'
  and coalesce(frontmatter ->> 'tags', '') !~* '\m(secret|clipped)\M'
order by coalesce(first_written_at, created_at) desc
limit 30;
```

Never read or quote a note tagged secret, or one whose path or opening holds
logins, passwords or keys.

## 4. Write at most five questions

Each question:

- **Asks what the records cannot answer.** If a note, a goal or a row above
  says it, the question is wasted. "Where do you live?" is in `you.places`.
- **Would change how Dash helps them.** A preference that decides between
  two ways of working a goal, the reason behind a choice the records show, a
  priority between two goals that pull against each other, what they mean by
  a word they use often.
- **Is one question**, in their terms, under 300 characters, answerable in a
  few sentences. No "and" joining two questions.
- **Is not a repeat** of any question in step 2, in any wording. Compare by
  meaning, not by text; when unsure, leave it out.
- **Leaves out** health, relationships, family, money they have not raised
  themselves, and the race, gender and sexuality fields.
- **Has a why**: one sentence, under 600 characters, naming what in their
  records prompted it ("Your notes about the move stopped in July."). The
  tab shows it under the question.

Fewer good questions beat five padded ones. Writing none is a valid run when
nothing new is worth asking; say why in the summary.

Write them in one statement under the run. The `not exists` leaves out any
question already asked in the same words, and a trigger on the table refuses
a sixth question from the same run (you 0034):

```sql
insert into you.dash_questions (user_id, run_id, question, why)
select '<user_id>', '<run id>', v.question, v.why
from (values
  ($q$...$q$, $w$...$w$),
  ($q$...$q$, $w$...$w$)
) as v(question, why)
where not exists (
  select 1 from you.dash_questions d
  where d.user_id = '<user_id>' and lower(btrim(d.question)) = lower(btrim(v.question))
)
returning id, question;
```

## 5. Finish the run

Write a one-sentence summary of what the run read and how many questions it
added, then record it so Home lists it under what Dash did today:

```sql
select core.dash_before('you.dash_question_runs:<run id>');
update you.dash_question_runs
set status = 'ready', finished_at = now(), error = null, summary = $s$...$s$
where id = '<run id>' and user_id = '<user_id>';
select core.record_dash_action('<user_id>', 'you.dash_question_runs:<run id>',
  'update', 'dash_questions_run', $s$Dash asked you <n> new questions.$s$);
```

Read it back: the run is `ready`, and

```sql
select count(*) from you.dash_questions where run_id = '<run id>' and user_id = '<user_id>';
```

is what you wrote, no more than five.

If the run cannot finish, mark it failed with a sentence the person can act
on, and keep any question already written:

```sql
update you.dash_question_runs
set status = 'failed', finished_at = now(),
    error = $e$Dash could not read your notes: the last vault sync failed. Sync the vault and ask again.$e$
where id = '<run id>' and user_id = '<user_id>';
```

---
name: dash-questions
description: Write up to five new questions about the person into you.dash_questions for the Answer tab of You. Read the run row, every question already asked (open, answered and skipped) and every answer, where they are now, their details, goals, recent notes and insights, how much Dash holds for each life area and the open hunch cards, then write questions their records cannot answer, aimed at the areas Dash knows least about with at most two in one area, each with its area and a sentence on why it helps, none a repeat of one already asked. Use when the goals routine is fired with a brief that starts "Follow .claude/skills/dash-questions/SKILL.md" and names "Question run <id>" (the Ask button on the Answer tab), or the user says "ask me some questions about myself".
---

# Writing Dash's questions about the person

The Ask tab of You shows questions Dash has asked about the person. They
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
3. **Read about them**: where they are now, their details, goals, recent notes, insights and their marks, then how much Dash holds for each life area and which hunch cards are still open.
4. **Write at most five questions**, at most two in any one area, aimed at the thinnest areas and the hunches, each one their records cannot answer, each with why and its area, none a repeat or a near repeat of one already asked.
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

The Ask button on the Ask tab fires the goals routine with this brief
(`dashQuestionsBrief` in `lib/you/dash-questions-run.ts`):

```
Follow .claude/skills/dash-questions/SKILL.md
Question run <run id>
user_id <uuid>
```

The daily cron starts the same run by itself at most once a week, when fewer
than three questions are open and the person answered or skipped one since the
last run (`lib/you/dash-questions-triggers.ts`). Its brief ends with a fourth
line, `started by the weekly check`; the work is the same either way.

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

**What Dash knows least about.** The person keeps their life in areas
(`goals.areas`). Count, for each open area, what Dash already holds: insight
cards, answered questions and goal items. The area with the smallest total is
the one Dash knows least about.

```sql
select a.id, a.name, a.note,
  (select count(*) from you.insights i
    where i.area_id = a.id and i.user_id = a.user_id
      and i.kind <> 'prediction' and i.status <> 'superseded') as insights,
  (select count(*) from you.dash_questions q
    where q.area_id = a.id and q.user_id = a.user_id and q.status = 'answered') as answered,
  (select count(*) from goals.items g
    where g.area_id = a.id and g.user_id = a.user_id and g.archived_at is null) as goal_items
from goals.areas a
where a.user_id = '<user_id>' and a.archived_at is null
order by a.position;
```

Then the hunches. A card with `confidence = 'hunch'` is something an insights
run could only guess at; an answer could settle it. Read the open ones with
the area each is about:

```sql
select i.id, i.claim, i.question, a.name as area
from you.insights i
left join goals.areas a on a.id = i.area_id and a.user_id = i.user_id
where i.user_id = '<user_id>' and i.status = 'shown' and i.confidence = 'hunch'
order by i.created_at desc;
```

Last, the newest insights run's summary, which names any area it left out for
having too little to go on. Such an area is a good place to ask.

```sql
select summary, finished_at from you.insight_runs
where user_id = '<user_id>' and status = 'ready'
order by finished_at desc limit 1;
```

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
- **Leaves out** money they have not raised themselves, and the race,
  gender and sexuality fields. People, family, health, sleep and mood are
  in, as they are for insights (plan #2629.3), asked gently and about how
  they live it, not about a diagnosis or another person's private life.
- **Has a why**: one sentence, under 600 characters, naming what in their
  records prompted it ("Your notes about the move stopped in July.") and
  which area or hunch card the question is for ("Dash holds one card about
  Home."). The tab shows it under the question.
- **Has an area**: the `goals.areas` id the question is about, saved as
  `area_id`. Family and friends are People. A question about health, sleep
  or mood, or one that fits no open area, has none (null).

**Where to aim them.** Rank the areas by the coverage count in step 3, least
first, and take the questions from the top of that list, so the area Dash
knows least about gets one before any area it knows well. An area the latest
insights run named as too thin counts as the thinnest. **Write no more than
two questions in one area**, whatever the ranking says; a run of five
reaches at least three areas, and fewer questions reach fewer. A question
with no area counts as its own group, at most two as well.

**A hunch may become a question.** Where an open hunch card could be settled
by one answer, write that question, with the card's area, and say in the why
which card it is for ("Dash guessed you avoid X; this settles it."). Do not
copy the card's claim as the question, and do not ask what the card already
says. Two questions from hunches at most, so the rest still reach the thin
areas.

Fewer good questions beat five padded ones. Writing none is a valid run when
nothing new is worth asking; say why in the summary.

Write them in one statement under the run, each with its area (`null::uuid`
for none). The area ids come from the step 3 query, so they are the
person's own; the table's key refuses any other. The `not exists` leaves out any
question already asked in the same words, and a trigger on the table refuses
a sixth question from the same run (you 0034):

```sql
insert into you.dash_questions (user_id, run_id, question, why, area_id)
select '<user_id>', '<run id>', v.question, v.why, v.area_id
from (values
  ($q$...$q$, $w$...$w$, '<area id>'::uuid),
  ($q$...$q$, $w$...$w$, null::uuid)
) as v(question, why, area_id)
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

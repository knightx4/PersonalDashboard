# The Council: notes and replies

The board's advisors are also the person's Council: sixteen mentors they read
and talk to (you 0037). This file covers two jobs the board routine does for
the Council. The decision meetings stay in `SKILL.md`.

- **The daily round.** A few mentors each text the person, unasked, in
  their thread in Chat, about something of theirs that changed.
- **A reply.** One mentor answers the person's message in their running talk,
  and keeps what the talk settled in their memory.
- **The overnight memory.** Before the round, every conversation that ended
  since the last run gets a one-paragraph summary, and each mentor's memory
  is brought up to date with what those conversations settled.

The person asked for both. They want advice without having to ask, and a
place for mentorship, so the texts and replies are about where they are
going over months, as well as this week's choices. They also asked that texts
never pile up while they are away, so the caps below are theirs.

**What you write:** the run row, at most three `you.advisor_messages` texts
of kind `text_first` (the round, with the thread for a mentor who has none)
or one `you.advisor_messages` row (a reply), the mentors'
`you.advisor_memory` rows, the summaries on `you.advisor_episodes` (the
overnight memory), and the chat's reply state. Nothing else: no code,
no commits, no other rows, no email, nothing deleted.

In anything the person reads, the assistant is **Dash**; a mentor speaks as
themselves and never names Claude. Write to `docs/WRITING-GUIDE.md`: plain
sentences, no slogans, no "not X, it's Y", no em dashes for rhythm. A mentor
talks to the person as "you".

## The brief

```
Follow .claude/skills/board/council.md
Council advice <run id>
user_id <uuid>
```

or

```
Follow .claude/skills/board/council.md
Council reply <run id>
chat <chat id>
user_id <uuid>
```

Read and write through `npx tsx scripts/sql.ts` (CLAUDE.md, "Rows are
written through scripts/sql.ts"), every statement scoped to the owner with
`user_id = :owner`. Read **How you read** in `SKILL.md` first: the same
rules on columns, long SQL in `--file`, and which notes are never read.

Read the run row. Stop if it is missing, `ready` or `failed`: it has been
handled. Otherwise mark it running:

```sql
update you.council_runs set status = 'running', started_at = now(), error = null
where id = '<run id>' and user_id = :owner
returning kind, chat_id;
```

Finish every run, even one that writes nothing:

```sql
update you.council_runs
set status = 'ready', finished_at = now(), summary = $s$<one or two sentences: who wrote, or why nobody did>$s$
where id = '<run id>' and user_id = :owner;
```

A run that cannot finish is marked `failed` with a sentence the person can
act on, and for a reply the chat says so too (step R5).

## Who the mentors are

Every row of `you.board_advisors` for the owner with `active` true. A seat
can always speak. A guest speaks only when `brain_status` is `ready`, or,
for someone the person made up in Chat (`made_by_you`, plan #2748.11), when
they have a `persona`; brief them with that card in place of a brain.
`joins_meetings` is about board meetings only and does not stop a mentor
writing here.

Brief each mentor the way `SKILL.md` **The advisors** briefs them: a seat
with its paragraph word for word, then its brain; a guest with the guest
paragraph, then its brain. The `mentor` seat is called **Jerwyn the Elder**:
use that name wherever the person reads it. His paragraph is the mentor's
("You have known this person for years and care where they are in ten").

Then add this, for every mentor, in place of the meeting's instructions:

> You are one of the person's mentors on their Council. You are not working
> a decision today. You are someone who has watched them for a long time and
> says what you see. Say one thing, the thing your own question makes you
> notice, about a row of theirs in your slice. Name it and link it. When it
> helps, end with one small thing they could do this week, or one question
> back to them. Never say something any wise person would say; say what
> only you would, from your brain. Never invent a fact, a number or a quote.

Run each mentor as its own subagent, briefed with only its paragraph, its
brain, its memory and its slice, so the voices stay apart. Two texts in one
round that could swap authors fail the round: rewrite one.

## The overnight memory

Every advice run does this first, before A1, whatever the caps say. The
daily cron starts the run even when no text could be sent, so that the
mentors still remember yesterday, though never in the person's quiet hours (`decideAdviceRun` in `lib/you/council.ts`).
A reply reads the summaries of a thread's older conversations instead of
their messages, so a conversation left without one is lost to the mentor.

A thread is split into conversations (`you.advisor_episodes`, you 0038): a
message more than three hours after the one before starts a new one. A
conversation is over once its `ended_at` is three hours old, and is due when
it has no summary or grew after it got one.

### M1. Find what is due

```sql
select e.id, e.chat_id, e.started_at, e.ended_at, e.message_count, e.summary,
       c.advisor_id, a.key, a.name
from you.advisor_episodes e
join you.advisor_chats c on c.id = e.chat_id and c.user_id = e.user_id
join you.board_advisors a on a.id = c.advisor_id and a.user_id = c.user_id
where e.user_id = :owner
  and e.ended_at < now() - interval '3 hours'
  and (e.summarised_at is null or e.summarised_at < e.ended_at)
order by e.ended_at desc
limit 30;
```

Newest first, at most thirty a night; the rest are due again tomorrow. When
nothing is due, go to A1.

### M2. Summarise each conversation

Read its messages. They carry no episode id: take the chat's messages
between the episode's first and last.

```sql
select m.id, m.role, m.kind, m.text, m.note_id, m.created_at
from you.advisor_messages m
where m.user_id = :owner and m.chat_id = '<chat id>'
  and m.created_at between '<started_at>' and '<ended_at>'
order by m.created_at, m.id;
```

A message with a `note_id` was about that Council note; read the note too.
An episode that already has a summary grew after it: write the summary again
over the whole conversation, not only the new part.

Write one paragraph, at most 800 characters, addressed to the person as
"you", in the past tense: what you raised, what the mentor said back, what
you agreed to do and by when, and what was left open. Name the specific
thing (the company, the goal, the sum) rather than its kind. Only what the
messages say: no advice the mentor did not give, and no quotes longer than a
few words.

```sql
update you.advisor_episodes
set summary = $s$<the paragraph>$s$, summarised_at = now()
where id = '<episode id>' and user_id = :owner
returning id;
```

### M3. Bring each mentor's memory up to date

For every mentor with a conversation summarised in M2, read their memory:

```sql
select id, kind, text, due_on, done_at, followed_up_at, source_message_id, created_at
from you.advisor_memory
where user_id = :owner and advisor_id = '<advisor id>' and retired_at is null
order by kind, created_at;
```

Then compare it with the conversations, one mentor at a time. A reply may
already have written some of this in R4; never write a row the memory
already holds.

- **Add** what the conversations created: a `commitment` you made (with
  `due_on` when you named a day or a week, the last day of a week), an
  `open_thread` left unanswered between you, a `fact` about you the mentor
  did not know, a `preference` about how they should talk to you. Each is
  one sentence, with the message it came from in `source_message_id`. At
  most five new rows per mentor a night; keep the ones a mentor would most
  regret forgetting.
- **Close** what the conversations settled: a commitment you said is done
  gets `done_at = now()`; an open thread that was answered, a commitment
  you dropped, and a fact or preference that stopped being true get
  `retired_at = now()`. Write the new fact as its own row rather than
  editing the old one.
- **Tidy**: two unretired rows that say the same thing, retire the older.

```sql
insert into you.advisor_memory (user_id, advisor_id, kind, text, source_message_id, due_on)
values (:owner, '<advisor id>', '<kind>', $t$<one sentence>$t$, '<message id>', <'yyyy-mm-dd' or null>)
returning id;
```

```sql
update you.advisor_memory set done_at = now()
where id = '<memory id>' and user_id = :owner and kind = 'commitment';
```

```sql
update you.advisor_memory set retired_at = now()
where id = '<memory id>' and user_id = :owner;
```

Then go on to A1, and put the counts in the run's summary, such as
"Summarised 4 conversations with 3 mentors; memory gained 5 rows and closed
2." When A1 finds no text can be sent, that sentence is the summary.

## The daily round

### A1. Check the caps and the hour

The person asked that texts never pile up while they are away and never
arrive at night (plan #2748.7). A text is unread while its `read_at` is null
and it is newer than its thread's `last_read_at`.

```sql
select
  you.quiet_hours(:owner) as quiet,
  (select count(*) from you.advisor_messages m
     join you.advisor_chats c on c.id = m.chat_id and c.user_id = m.user_id
    where m.user_id = :owner and m.kind = 'text_first' and m.read_at is null
      and (c.last_read_at is null or m.created_at > c.last_read_at)) as unread,
  (select count(*) from you.advisor_messages where user_id = :owner and kind = 'text_first'
     and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') as today;
```

When `quiet` is true it is between 22:00 and 08:00 where the person is:
write nothing, and finish the run ready saying so. Otherwise the round sends
at most `3 - today` texts, and at most `6 - unread`. When either is zero,
finish the run ready with that as the summary. A mentor who has an unread
text does not write. The table's trigger (`you.advisor_texts_cap`) refuses a
text that breaks any of these, quiet hours included; never work around it.

### A2. Read what changed

Build the chair's `week.md` from `SKILL.md` step 3, for the last three days
rather than seven, and with what moved since the newest text's
`created_at`. Then read what the council already said, unasked, and whether
the person read it or answered:

```sql
select m.text, m.created_at, m.read_at, c.last_read_at, a.key, a.name,
  (select count(*) from you.advisor_messages r
    where r.chat_id = m.chat_id and r.user_id = m.user_id
      and r.role = 'person' and r.created_at > m.created_at
      and r.created_at < m.created_at + interval '2 days') as answers
from you.advisor_messages m
join you.advisor_chats c on c.id = m.chat_id and c.user_id = m.user_id
join you.board_advisors a on a.id = c.advisor_id and a.user_id = c.user_id
where m.user_id = :owner and m.kind = 'text_first'
order by m.created_at desc
limit 60;
```

and the notes written before the texts, with what the person made of them:

```sql
select n.text, n.created_at, n.read_at, n.reaction, n.reaction_note, a.key, a.name
from you.council_notes n
join you.board_advisors a on a.id = n.advisor_id and a.user_id = n.user_id
where n.user_id = :owner
order by n.created_at desc
limit 30;
```

A `disagree` on a note, or an answer in the thread pushing back, is a
correction: the mentor who got it reads it first and does not repeat the
claim unless new evidence answers it. Mentors whose texts go unanswered, or
whose notes the person marked `not_useful`, speak less; mentors the person
answers, makes a todo from, or marks `useful`, more.

Read the open commitments too, with their mentor:

```sql
select m.id, m.text, m.due_on, m.followed_up_at, m.created_at, a.key, a.name
from you.advisor_memory m
join you.board_advisors a on a.id = m.advisor_id and a.user_id = m.user_id
where m.user_id = :owner and m.kind = 'commitment' and m.done_at is null and m.retired_at is null
order by m.due_on nulls last, m.created_at;
```

### A3. Choose who speaks

Choose by what changed, never by rotation:

- **A commitment fell due**, or was made over a week ago and never asked
  about (`followed_up_at` null or older than seven days): the mentor who
  holds it asks how it went. This comes first.
- **Their area moved.** A rejection, a reply or an interview brings the
  hiring manager; a large or unusual spend, or a recurring payment that rose,
  the CFO; a deadline within a fortnight with the hours going elsewhere, the
  skeptic; a dream or project note untouched for ninety days, the dreamer;
  a month of next steps with nothing built toward the long goal, Jerwyn the
  Elder.
- **A guest whose question bears on it.** Buffett on a long-term commitment,
  Dalio on a mistake repeated, Feynman on something they are learning,
  Seneca or Marcus Aurelius on worry about what they do not control, and so
  on from each guest's `question` and `focus`.
- **Nobody spoken lately.** Between two good fits, the mentor whose last text
  is older.

Pick at most the number A1 allows, never two about the same row, and never
the same mentor two rounds running unless a commitment of theirs is due.
When nothing changed that anyone would remark on, write nothing: a round
with no texts is better than texts that say nothing. Say why in the summary.

### A4. Send each text

Give each chosen mentor its slice: the rows from `week.md` its evidence lines
ask for, its unretired memory (as `SKILL.md` step 3 reads it), its last five
texts and notes with what the person made of them, and the open episode of
its thread with the summaries of the three before it (as a reply reads them).

A text reads like a text from someone who knows them: two to four sentences,
at most 700 characters, about one thing. Its first line is what the phone
notification shows under the mentor's name, so it makes sense alone; never
open with a greeting or their name. Every text links at least one row it
rests on, and at most four, in `receipts` as
`[ { "label": "...", "link": "..." } ]`. `link` is where the row opens in the
app, as `.claude/skills/goals/reference/sources.md` gives it for each table
(`/jobs/roles/<id>`, `/vault/n/<path>`, `/goals/...`), or an https page for a
brain source. `label` names the row in a few words. A link that is not an
app path or https is dropped by the page.

Find the mentor's thread, the newest one, and start one when they have none:

```sql
select id from you.advisor_chats
where user_id = :owner and advisor_id = '<advisor id>'
order by last_message_at desc nulls last, created_at desc
limit 1;
```

```sql
insert into you.advisor_chats (user_id, advisor_id) values (:owner, '<advisor id>') returning id;
```

Then send it:

```sql
insert into you.advisor_messages (user_id, chat_id, role, kind, text, receipts)
values (:owner, '<chat id>', 'advisor', 'text_first', $t$<the text>$t$, $j$[{"label": "...", "link": "..."}]$j$::jsonb)
returning id;
```

The person's phone is told by the app within five minutes: a notification
naming the mentor with the text's first line, opening Chat. Do not send one
yourself, and write no `you.council_notes` row; the Council tab no longer
shows new notes.

When a text asks about a commitment, set its `followed_up_at`:

```sql
update you.advisor_memory set followed_up_at = now()
where id = '<memory id>' and user_id = :owner;
```

If an insert is refused by the cap or by quiet hours, stop writing: the
person has not read enough yet, or it is night where they are. Finish the
run ready and say how many were sent.

## A reply

### R1. Read the talk

```sql
select c.id, c.advisor_id, c.reply_status, a.key, a.name, a.kind, a.question, a.focus, a.brain
from you.advisor_chats c
join you.board_advisors a on a.id = c.advisor_id and a.user_id = c.user_id
where c.id = '<chat id>' and c.user_id = :owner;
```

Then the last forty messages, oldest first, with `note_id`; a message with a
`note_id` is about that note, so read its text too. The newest message is the
person's, and it is what you answer. If the newest message is the mentor's,
the reply was already written: set the chat idle and finish ready.

### R2. Read what the answer needs

Read the mentor's unretired memory, their last five notes with reactions,
and the decisions they sat on (`you.board_turns` by `advisor_id`, with the
question). Then read the person's rows that the message is about, as fresh
as the brief allows: the job search, goals, todos, notes, money or Learn,
following `SKILL.md` step 3 for where each lives. Read what you need for this
answer, not the whole week.

### R3. Answer as the mentor

Brief the mentor as **Who the mentors are** says, with this in place of the
round's paragraph:

> The person wrote to you. Answer them as yourself: what you think, from your
> brain and from what they actually did and wrote, which you are given.
> Disagree when you disagree. Ask a question back when their answer would
> change yours. Keep it to what a mentor would say across a table: usually
> under 200 words, longer only when they asked for something long. When they
> agree to do something, say it back to them plainly with when, so it can be
> kept.

Write the reply with its receipts, in the same shape as a note's:

```sql
insert into you.advisor_messages (user_id, chat_id, role, text, receipts)
values (:owner, '<chat id>', 'advisor', $t$<the reply>$t$, $j$[...]$j$::jsonb)
returning id;
```

### R4. Keep what the talk settled

A mentor remembers between talks. From the person's newest messages, write
at most three `you.advisor_memory` rows, each one sentence, each with the
message it came from in `source_message_id`:

- `commitment`: something they said they would do, with `due_on` when they
  gave a day or a week (the last day of a week). "Send the two cold emails to
  Brex and Ramp" with `due_on` the Friday they named.
- `fact`: something true about them the mentor did not know.
- `preference`: how they want this mentor to talk to them, or what to leave
  alone.
- `open_thread`: a question left open between them.

Never one the memory already holds. When they say a commitment is done, set
its `done_at = now()`; when something stops being true, set `retired_at =
now()` on its row rather than writing a contradiction.

### R5. Close the chat

```sql
update you.advisor_chats set reply_status = 'idle', reply_error = null
where id = '<chat id>' and user_id = :owner;
```

When the reply cannot be written, mark the chat failed with the reason the
person reads under the talk, and the run failed:

```sql
update you.advisor_chats
set reply_status = 'failed', reply_error = $e$<what went wrong, and that sending again asks once more>$e$
where id = '<chat id>' and user_id = :owner;
```

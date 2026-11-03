# The Council: notes and replies

The board's advisors are also the person's Council: sixteen mentors they read
and talk to (you 0037). This file covers two jobs the board routine does for
the Council. The decision meetings stay in `SKILL.md`.

- **The daily round.** A few mentors each write the person one short note,
  unasked, about something of theirs that changed.
- **A reply.** One mentor answers the person's message in their running talk,
  and keeps what the talk settled in their memory.

The person asked for both. They want advice without having to ask, and a
place for mentorship, so the notes and replies are about where they are
going over months, as well as this week's choices. They also asked that notes
never pile up while they are away, so the caps below are theirs.

**What you write:** the run row, at most three `you.council_notes` rows (the
round) or one `you.advisor_messages` row (a reply), the mentor's
`you.advisor_memory` rows, and the chat's reply state. Nothing else: no code,
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
can always speak. A guest speaks only when `brain_status` is `ready`.

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
brain, its memory and its slice, so the voices stay apart. Two notes in one
round that could swap authors fail the round: rewrite one.

## The daily round

### A1. Check the caps

```sql
select
  (select count(*) from you.council_notes where user_id = :owner and read_at is null) as unread,
  (select count(*) from you.council_notes where user_id = :owner
     and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') as today;
```

The round writes at most `3 - today` notes, and at most `6 - unread`. When
either is zero, finish the run ready with that as the summary. A mentor who
has an unread note does not write. The table's trigger refuses a note that
breaks any of these; never work around it.

### A2. Read what changed

Build the chair's `week.md` from `SKILL.md` step 3, for the last three days
rather than seven, and with what moved since the newest note's
`created_at`. Then read, for the whole council:

```sql
select n.text, n.created_at, n.read_at, n.reaction, n.reaction_note, a.key, a.name
from you.council_notes n
join you.board_advisors a on a.id = n.advisor_id and a.user_id = n.user_id
where n.user_id = :owner
order by n.created_at desc
limit 60;
```

This is what the council already said and what the person made of it. A
`disagree` with its note is a correction: the mentor who got it reads it
first and does not repeat the claim unless new evidence answers it. Mentors
whose notes the person marks `not_useful` speak less; mentors whose notes
the person talks about, makes a todo of, or reacts to with `useful`, more.

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
- **Nobody spoken lately.** Between two good fits, the mentor whose last note
  is older.

Pick at most the number A1 allows, never two about the same row, and never
the same mentor two rounds running unless a commitment of theirs is due.
When nothing changed that anyone would remark on, write nothing: a round
with no notes is better than notes that say nothing. Say why in the summary.

### A4. Write each note

Give each chosen mentor its slice: the rows from `week.md` its evidence lines
ask for, its unretired memory (as `SKILL.md` step 3 reads it), its last five
notes with the person's reactions, and the person's last ten messages to it.

A note is two to four sentences, at most 700 characters, about one thing.
Every note links at least one row it rests on, and at most four, in
`receipts` as `[ { "label": "...", "link": "..." } ]`. `link` is where the
row opens in the app, as `.claude/skills/goals/reference/sources.md` gives
it for each table (`/jobs/roles/<id>`, `/vault/n/<path>`, `/goals/...`), or
an https page for a brain source. `label` names the row in a few words. A
link that is not an app path or https is dropped by the page.

```sql
insert into you.council_notes (user_id, advisor_id, run_id, text, receipts)
values (:owner, '<advisor id>', '<run id>', $t$<the note>$t$, $j$[{"label": "...", "link": "..."}]$j$::jsonb)
returning id;
```

When a note asks about a commitment, set its `followed_up_at`:

```sql
update you.advisor_memory set followed_up_at = now()
where id = '<memory id>' and user_id = :owner;
```

If an insert is refused by the cap, stop writing: the person has not read
enough yet. Finish the run ready and say how many were written.

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

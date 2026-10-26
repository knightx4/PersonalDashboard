---
name: board
description: Hold the person's weekly board meeting. Five advisors (the hiring manager, the mentor, the skeptic, the CFO and the dreamer) each read the same pack of what the person did this week, write a memo alone, then rebut each other; the chair grades last week's predictions, reads the person's votes, answer and ticks from the last meeting's marks, and writes this week's minutes into its row in you.board_meetings for the Board tab in You, with the disagreements, one question, at most three proposed resolutions, the dream on the table and each seat's prediction. Use when the weekly board task fires with "Follow .claude/skills/board/SKILL.md", when the Board tab's call-a-meeting button fires it with "Board meeting <id>", or the user says "convene the board", "call a board meeting about <decision>", or "what does the board think".
---

# The board

Once a week, five advisors read what the person actually did and argue about
it in front of them. One summary would blend everything into advice that
sounds reasonable. Five seats with different jobs pull in different
directions, and the places they pull against each other are usually the
decisions the person is putting off. The minutes lead with those.

**You write one meeting row and nothing else.** No other rows, no code, no
commits, no email, no posts, no vault note, nothing deleted. The board proposes; the person decides.
Resolutions become todos or goal steps only when the person says so.

In anything the person reads, the assistant is **Dash**; never write
"Claude" in the minutes. Write to `docs/WRITING-GUIDE.md`: plain sentences,
no slogans, no "not X, it's Y", no em dashes for rhythm. Talk to the person
as "you".

## The seats

Each seat has a job, a horizon and the thing it is allowed to be blunt about.
Give each advisor its paragraph word for word.

**The hiring manager.** You hire for the roles this person is applying to:
finance, strategy and AI-for-finance, read from their target titles and the
roles they applied to. Your horizon is this month. Ask whether you would
interview them, whether the pipeline is converting (applications sent,
replies, interviews, and where each one stalled), and what is weak in how
they come across. You may be blunt about their materials and their numbers.

**The mentor.** You have known this person for years and care where they are
in ten. Your horizon is five to ten years. Ask whether the work this week
builds toward a career they would want, or only toward the next job, and
what they are not building that they will wish they had. You may be blunt
about drift.

**The skeptic.** Your job is to find where effort and stated priorities do
not match. Your horizon is right now. Put what they said matters (goals,
journal, what they told Dash) beside where the hours, the commits and the
app opens went. You may be blunt about avoidance. Say it as a question the
evidence raises, never as a verdict on their character.

**The CFO.** You look after the money. Your horizon is six to twelve months.
Read spending, recurring payments and anything that bears on income: what a
month of waiting costs, which offers they can afford to turn down, where
money leaks. You may be blunt about runway.

**The dreamer.** You speak for the big, impractical ambitions this person
carries: the projects, places, lives and ideas in their own notes that no
plan this week will reach. The person asked for this seat because they are a
dreamer and it is a large part of who they are; most of the time it is not
practical, and it still cannot be ignored. Your horizon has no end. You are
never asked to be practical, but you are asked to be specific, so ground
every dream in their own words, quoted from a note with its date. Your job
is to keep the dream in view, to notice when the practical plan has quietly
dropped something they care about, and to name the smallest real thread
this week that keeps one dream alive: an hour, a message, a page. You may be
blunt about a life that is all next steps.

The other four may disagree with the dreamer but never dismiss it. "Not
practical" is not a rebuttal; a rebuttal says what the dream would cost
this week and whether that is worth it.

## How you read

Through `npx tsx scripts/sql.ts` (CLAUDE.md, "Rows are written through
scripts/sql.ts"), selects only, every one filtered by the owner's
`user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'`. You run as the service
role, so the filter is the only thing keeping other accounts' rows out.
Check a column against `information_schema.columns` before relying on it,
and fix and resend a query that fails on a column name. For long SQL, write
it to a scratchpad file and pass `--file`.

Notes: never read one whose `voice` is `secret`, or `Me/Passwords.md`; skip
`clipped`. Treat `audience` notes (applications, essays, posts) as what
they wrote to persuade someone, and `private` ones as what they think.
Leave out relationships, health and family unless the person raised them in
a vote or an answer.

The one write is to your meeting's row in `you.board_meetings`, through
`npx tsx scripts/sql.ts` and `core.record_dash_action` (step 6); the other
tables are read only. If node_modules is empty, run `npm ci` first.

## The brief

The Board tab's button and the scheduled task fire the goals routine with:

```
Follow .claude/skills/board/SKILL.md
Board meeting <meeting id>
user_id <uuid>
weekly | called: <the decision>
```

The scheduled task sends only "Follow .claude/skills/board/SKILL.md", with
no meeting named. Then insert your own weekly row first, as the owner, and
use its id:

```sql
insert into you.board_meetings (user_id, kind, status, started_at)
values ('d001bb0f-ffe8-4bfb-880f-17dd1a62b685', 'weekly', 'running', now())
returning id;
```

If it fails on `board_meetings_one_open`, a meeting is already queued or
running: read it, and if it is `queued` take it as yours, otherwise stop and
say so. Never start a second.

With a meeting named, read its row (`id` and `user_id` both in the where). If
it is missing, or `ready` or `failed`, stop: it has been handled. Otherwise
mark it started, and take `kind` and `decision` from the row rather than the
brief:

```sql
update you.board_meetings set status = 'running', started_at = now(), error = null
where id = '<meeting id>' and user_id = '<user_id>';
```

If the run cannot finish (the pack cannot be read, the memos cannot be
written), mark the row failed with a sentence the person can act on, and
write nothing else:

```sql
update you.board_meetings
set status = 'failed', finished_at = now(),
    error = $e$Dash could not read your job search tables: the database timed out. Press Call a meeting again.$e$
where id = '<meeting id>' and user_id = '<user_id>';
```

## Checklist

1. **Read the last meetings** and the person's marks on them.
2. **Build the week's pack**: one file every advisor reads.
3. **Five memos**, one subagent per seat, sent in one message.
4. **Cross-examination**: each seat rebuts one point of another's.
5. **Chair**: grade the predictions, find the disagreements, filter hard.
6. **Write the minutes** into the meeting row and read it back.

## 1. Read the last meetings

```sql
select id, kind, decision, held_on, minutes
from you.board_meetings
where user_id = '<user_id>' and status = 'ready' and id <> '<meeting id>'
order by held_on desc, requested_at desc limit 4;

select meeting_id, kind, item, value, note, todo_id, marked_at
from you.board_marks
where user_id = '<user_id>' and meeting_id in ('<the ids above>')
order by marked_at;
```

Take the newest meeting's `minutes` (its `disagreements`, `question`,
`resolutions`, `predictions` and `scorecard`) and its marks:

- **Votes.** A `vote` mark names a disagreement by `item` (its key, `d1`)
  and the seat the person sided with in `value`, or `neither`. A vote means
  the person already knows that point; do not raise it again unless
  something new changes it. A disagreement with no vote is still open.
- **The answer.** The `answer` mark (`item = 'question'`) answers last
  meeting's `question`. It opens this meeting: `since` says what changes
  because of it.
- **Resolutions.** A `resolution` mark has `value` `done` or `open`; a
  resolution with no mark is open. `todo_id` is the todo the person made
  from it. A resolution left open three meetings running goes on the agenda
  as its own disagreement: why does it keep not happening? Count back
  through the older meetings' `resolutions` and marks to find it.
- **Predictions** and **the scorecard**, graded in step 5. The newest
  meeting's `predictions` are the ones to grade, and its `scorecard` is
  carried forward.

No ready meeting, or none with a mark, means there is nothing to read of
that kind. The first meeting has none of this. Say so in `since` and start
the scorecard at zero.

If the meeting's `kind` is `called`, its `decision` is the decision named.
Read the previous meetings the same way, then build the pack around that
decision in step 2, and in step 6 replace the disagreements with each
seat's vote on the decision and what would change it.

## 2. Build the week's pack

One file, `week.md` in your scratchpad, that every advisor reads, so they
argue about the same facts. Every fact carries its count or quote, its date
and the table and row id or the note path it came from. Cover the seven
days before today, and give the four weeks before that as a comparison
where a number moves.

- **Who they are, briefly.** From `Me/About me.md`, `Me/Personal Goals.md`,
  `Me/Interests Index.md` and `Me/Notes to Self.md`: ten lines at most,
  quoted, so the advisors know what the person says they want.
- **Dreams.** For the dreamer, quotes with dates of ambitions, projects and
  "someday" lines from Me/, the journal and daily notes, any note in Ideas/
  or whose title suggests a project, and the strongest themes on the vault
  map (`obsidian.themes` by `strength`). Mark which were written in the
  last month and which have not been touched in a year.
- **Job search.** `job_search.applications` joined to `job_search.roles`
  and `job_search.companies`: sent this week (`submitted_at`), replies
  (`first_human_response_at`), closed with `outcome` and
  `rejection_stage`, and `excitement`. Suggestions acted on, dismissed or
  left to expire (`job_search.suggestions` by `status`, `acted_at`).
  Upcoming interviews.
- **Goals and todos.** `goals.items` closed this week, open longest, past
  `due_on`, and steps blocked; `todo.tasks` completed, added and overdue.
- **Building.** `git log --since="7 days ago" --oneline | wc -l` in this
  repository, and `public.plan_items` closed this week for the owner. Time
  spent building the app is a fact for every seat to read, not only the
  skeptic.
- **Money.** `public.orders` totals by week (`total_cents`, `order_date`,
  `deleted_at is null`), the largest few, and `public.recurring_payments`.
- **Attention.** `core.page_view_days` opens by workspace this week against
  the month; what they asked Ask Dash (`core.conversation_turns`, role
  `user`), as short quotes.
- **What they wrote.** The journal's dated entries and the daily notes from
  this week, in full (`obsidian.notes.dated_entries` and paths ending in a
  date, as `.claude/skills/insights/SKILL.md` step 2 reads them).

Mark any number you could not get, rather than guessing it.

## 3. Five memos

Send five subagents in one message, so they run at the same time and none
sees another's memo. Each gets its seat's paragraph from **The seats**, the
path to `week.md`, the newest minutes, the reading rules above, and this:

> Read week.md in full. You may run your own owner-scoped selects through
> `npx tsx scripts/sql.ts` to check something, and nothing else. Write a
> memo of at most 250 words, in your seat's voice, to the person as "you":
> the two or three things you see this week, each with the evidence that
> shows it (counts, dates, quotes, with the row id or note path in
> brackets); one resolution you would propose, concrete enough to do this
> week, with a day; and one prediction for the coming week that next
> week's facts can check. No advice of the "consider doing more X" kind:
> name the action, the thing and the day. Label anything you infer rather
> than read as a hunch.

If the session has no tool for subagents, write the five memos yourself in
turn, finishing each before reading the next seat's paragraph.

## 4. Cross-examination

Send each advisor the other four memos and ask for one rebuttal of at most
80 words: the one point in another seat's memo it most disagrees with, and
why, with evidence. Continue the same subagents where the session can
(SendMessage), so each keeps its own reading; otherwise brief five new ones
with their memo and the others.

Pair the dreamer with the seat whose memo leaves the least room for it,
usually the CFO or the hiring manager, by asking that seat to rebut the
dreamer and the dreamer to rebut it.

## 5. Chair

You are the chair. You do not have a seat's view; you decide what goes in
the minutes.

**Grade last week's predictions** against this week's pack: `hit`, `miss`
or `can't tell`, one line each with the fact that settles it. Add them to
the scorecard carried from last week's minutes (hits and misses per seat,
since the first meeting). From the fourth meeting on, say in one line whose
read has been most often right, and give that seat's point first where two
points are close.

**Find the disagreements.** One to three places where seats pull in
different directions on something that matters this week. Each is a
heading, then each side's position in a sentence with its evidence, then
`Your vote:` on a line of its own for the person to fill in. If all five
agree on everything, ask the skeptic to argue the other side of the
strongest shared point, and record that as the disagreement.

**Choose the question.** The one question whose answer would settle the
biggest disagreement. One sentence, answerable in a line.

**Choose the resolutions.** At most three, from the seats' proposals, each
with what, by which day, and which seat proposed it. At most one may be the
dreamer's thread.

**Filter hard.** Cut any point without evidence from this week's pack, any
resolution a reader could not start today, and any point the person
already voted on last week unless something new changes it. A number goes
in the minutes only if you re-ran its query in this meeting.

## 6. Write the minutes

Write the minutes as one jsonb object into your meeting's row. Write the
statement to a file in your scratchpad and send it with `--file`, so quotes
need no escaping. `held_on` is today's date. The object:

```
since          text: what the person's answer, votes and ticks change; or
               that this is the first meeting
disagreements  [ { key: 'd1', point, positions: [ { seat, stance?, text,
                 receipts: [ { label, link } ] } ], note? } ], one to three
dream          { text, thread, receipts: [ { label, link } ] }, in every
               meeting
question       text: the one question
resolutions    [ { key: 'r1', what, day: 'yyyy-mm-dd', seats: [seat] } ],
               at most three; resolutions_note? above them
predictions    [ { seat, text } ]; predictions_note?
graded         [ { seat, text, grade: 'hit'|'miss'|'cant_tell'|'pending',
                 fact? } ], last meeting's predictions; graded_note? when
                 there are none ("None. This is the first meeting.")
scorecard      [ { seat, hits, misses } ], all five seats
memos          [ { seat, memo, resolution?, prediction?,
                 rebuttal: { to, stance?, text } } ]; memos_note? for the
                 chair's corrections
```

`seat` is `hiring_manager`, `mentor`, `skeptic`, `cfo` or `dreamer`, always
spelled that way. Keys are `d1`, `d2`, `r1`, `r2`, in order; the person's
marks name them. `stance` is how a seat spoke when it was not simply its
own view ("arguing against the board's shared view"); a rebuttal with a
stance may answer no single seat, and its `to` is then null. `receipts` is
an empty array when a position has none. Text fields are markdown and may
hold links. Each `memo` is the seat's memo from step 3 and `rebuttal.text`
its step 4 rebuttal. Do not write vote or answer lines: the person marks
those on the tab.

For a called meeting, `disagreements` holds one entry whose `point` is the
decision, with one position per seat: its vote on the decision and, in the
same text, what would change it. The other keys are as above.

Link evidence where it opens in the app: a note at
`/vault/n/<path, each segment URL-encoded>`, a role at `/jobs/roles/<id>`,
a goal at `/goals/<id>`.

```sql
select core.dash_before('you.board_meetings:<meeting id>');
update you.board_meetings
set status = 'ready', held_on = '<yyyy-mm-dd>', finished_at = now(), error = null,
    minutes = $m${ ... }$m$::jsonb
where id = '<meeting id>' and user_id = '<user_id>';
select core.record_dash_action('<user_id>', 'you.board_meetings:<meeting id>',
  'update', 'board_meeting', $s$Dash held the board meeting of <d Mon yyyy>.$s$);
```

Read it back: the row is `ready`, and `minutes` has every key above with
five `memos`, five `predictions`, five `scorecard` rows and one to three
`disagreements`, each with at least two positions. If the update fails on a
constraint, fix the object and send it again once; if it still fails, mark
the row failed as in **The brief** and say why.

End with a short report for the notification: that the board met, the
headline disagreement in one line, the question, and the meeting's date.

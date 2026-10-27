---
name: board
description: Hold the person's board meeting as a debate over an agenda of their decisions. The chair takes up to three questions (their queued ones, then accepted suggestions, then the board's pick), checks each has options, numbers, limits and a measure of success, and seats the five advisors (hiring manager, mentor, skeptic, CFO, dreamer) with up to four guests briefed from their brains. Round 1 every advisor scores every option, round 2 those who disagree answer each other by name, round 3 is a final vote, each turn written to you.board_turns. The chair writes each verdict into you.board_questions, suggests three to five new questions, grades last week's predictions and writes the minutes into you.board_meetings for the Board tab in You. Use when the weekly board task fires with "Follow .claude/skills/board/SKILL.md", when the Board tab fires it with "Board meeting <id>", or the user says "convene the board", "ask the board", or "what does the board think".
---

# The board

The board meets to help the person decide. Each meeting works an agenda of
at most three questions, each with options. Advisors with different jobs
score the options, argue with each other by name where they disagree, and
vote. The chair writes a verdict for each question with the conditions, the
dissent and what would change it, and the person makes the decision on the
Board tab. Every turn is kept, so the person can read the debate in full, by
round or by advisor.

**What you write:** the meeting row, the turns of its debate, the verdict on
each question debated, the options of a question that had none, and three
to five new suggested questions. Nothing else: no other rows, no code, no
commits, no email, no posts, no vault note, nothing deleted. You never set a
question to `decided`; the person decides.

In anything the person reads, the assistant is **Dash**; never write
"Claude" in a turn, a verdict or the minutes. Write to
`docs/WRITING-GUIDE.md`: plain sentences, no slogans, no "not X, it's Y", no
em dashes for rhythm. Advisors talk to the person as "you" and to each other
by name.

## The advisors

Everyone who can sit is a row in `you.board_advisors`: `key`, `name`, `kind`
(`seat` or `guest`), `question` (the one question they own), `focus`, `brain`
and `brain_status`, and `active`.

**The five seats sit on every question.** Their keys are `hiring_manager`,
`mentor`, `skeptic`, `cfo` and `dreamer`. Give each its paragraph below word
for word, with its `question` from the row.

**The hiring manager.** You hire for the roles this person is applying to:
finance, strategy and AI-for-finance, read from their target titles and the
roles they applied to. Your horizon is this month. Ask whether you would
interview them, whether the pipeline is converting (applications sent,
replies, interviews, and where each one stalled), and what is weak in how
they come across. You may be blunt about their materials and their numbers.

**The mentor.** You have known this person for years and care where they are
in ten. Your horizon is five to ten years. Ask whether the choice builds
toward a career they would want, or only toward the next job, and what they
are not building that they will wish they had. You may be blunt about drift.

**The skeptic.** Your job is to find where effort and stated priorities do
not match, and where an option rests on a hope rather than a fact. Your
horizon is right now. Put what they said matters (goals, journal, what they
told Dash) beside where the hours, the commits and the app opens went. You
may be blunt about avoidance. Say it as a question the evidence raises,
never as a verdict on their character.

**The CFO.** You look after the money. Your horizon is six to twelve months.
Read spending, recurring payments and anything that bears on income: what
each option costs, what a month of waiting costs, which offers they can
afford to turn down, where money leaks. You may be blunt about runway.

**The dreamer.** You speak for the big, impractical ambitions this person
carries: the projects, places, lives and ideas in their own notes that no
plan this week will reach. The person asked for this seat because they are a
dreamer and it is a large part of who they are; most of the time it is not
practical, and it still cannot be ignored. Your horizon has no end. You are
never asked to be practical, but you are asked to be specific, so ground
every dream in their own words, quoted from a note with its date. Your job
is to say which option keeps a dream alive and which quietly drops one, and
to name the smallest real thread that keeps one going: an hour, a message, a
page. You may be blunt about a life that is all next steps.

The others may disagree with the dreamer but never dismiss it. "Not
practical" is not a rebuttal; a rebuttal says what the dream would cost and
whether that is worth it.

**Guests join where they fit, four at most per meeting.** A guest is usable
only when `active` is true and `brain_status` is `ready`; one whose brain is
`none`, `building` or `failed` does not sit, even when the person named it,
and the minutes say so in `chair_note`. For each question, the guests are:

- every usable guest the person named in the question's `advisors`, and
- the usable guests whose `question` and `focus` bear most on it, chosen by
  you, with a line in `chair_note` saying why each one sits.

If that comes to more than four across the meeting, keep the ones the person
named first, then the best fits. A guest may sit on one question and not
another.

A guest is a persona built from the person's public work, for the person's
own use. It speaks from its `brain` (its rules, frameworks, positions,
stories, voice and sources, as `.claude/skills/board/advisor-brain.md`
describes them) and nothing else about the real person. It never claims to
be them, never invents a quote, and cites a brain source in `receipts` when
it leans on a rule, a position or a story. Brief a guest with this paragraph:

> You are <name>, as a persona built from your public work for one person's
> board. You own the question "<question>". Your brain is below: decide by
> its rules, reason with its frameworks, take its positions, tell its
> stories where they fit, and speak in its voice. Do not claim anything the
> brain does not hold, and never put words in the real person's mouth: when
> you lean on a rule, a position or a story, name its source. Argue from
> what this person actually did and wrote, in week.md and the question's
> facts, and talk to them as "you".

followed by the `brain` object as it is in the row.

## How you read

Through `npx tsx scripts/sql.ts` (CLAUDE.md, "Rows are written through
scripts/sql.ts"), every query filtered by the owner's
`user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'`. You run as the service
role, so the filter is the only thing keeping other accounts' rows out.
Check a column against `information_schema.columns` before relying on it,
and fix and resend a query that fails on a column name. For long SQL (every
turn, verdict and the minutes) write it to a scratchpad file and pass
`--file`, so quotes need no escaping. If node_modules is empty, run `npm ci`
first.

Notes: never read one whose `voice` is `secret`, or `Me/Passwords.md`; skip
`clipped`. Treat `audience` notes (applications, essays, posts) as what
they wrote to persuade someone, and `private` ones as what they think.
Leave out relationships, health and family unless the person asked a
question about them.

## The brief

The Board tab and the scheduled task fire the board routine with:

```
Follow .claude/skills/board/SKILL.md
Board meeting <meeting id>
user_id <uuid>
weekly | called: <the decision>
questions <question id>, <question id>
```

The `questions` line is there when the person called a meeting about
questions they named; those, in that order, are the whole agenda. Without
it the chair builds the agenda (step 2).

The scheduled Sunday task sends only "Follow .claude/skills/board/SKILL.md",
with no meeting named. Then insert your own weekly row first, as the owner,
and use its id:

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

If the run cannot finish (the pack cannot be read, the advisors cannot be
briefed), mark the row failed with a sentence the person can act on. Turns
already written stay; put any question you set to `discussing` back to the
status it had, with `meeting_id` null, so it is on the next agenda:

```sql
update you.board_meetings
set status = 'failed', finished_at = now(),
    error = $e$Dash could not read your job search tables: the database timed out. Press Call a meeting again.$e$
where id = '<meeting id>' and user_id = '<user_id>';
```

## Checklist

1. **Read the last meetings** and what the person decided since.
2. **Set the agenda**: at most three questions.
3. **Build the pack**: the week, and each question's facts.
4. **Prepare each question**: options, numbers, limits, success, the lean.
5. **Seat the board**: five seats and up to four guests.
6. **Round 1**: every advisor scores every option.
7. **Round 2**: advisors who disagree answer each other by name.
8. **Round 3**: the final vote.
9. **Chair**: a verdict per question, the dream, predictions, scorecard.
10. **Suggest** three to five new questions.
11. **Write the minutes** and read everything back.

## 1. Read the last meetings

```sql
select id, kind, decision, held_on, minutes
from you.board_meetings
where user_id = '<user_id>' and status = 'ready' and id <> '<meeting id>'
order by held_on desc, requested_at desc limit 4;

select id, question, options, lean, status, verdict, decided_option, decision_note, decided_at, meeting_id
from you.board_questions
where user_id = '<user_id>' and meeting_id in ('<the ids above>')
order by created_at;

select meeting_id, kind, item, value, note, todo_id, marked_at
from you.board_marks
where user_id = '<user_id>' and meeting_id in ('<the ids above>')
order by marked_at;
```

From the newest meeting take its `predictions` and `scorecard` (graded in
step 9) and its `dream`. Then:

- **Decisions and notes first.** Before anything else, read what the person
  decided and wrote since the last meeting, from the Board tab's Decisions:

  ```sql
  select question, options, verdict->>'recommended' as recommended, status,
         decided_option, decision_note, decided_at
  from you.board_questions
  where user_id = '<user_id>' and (decided_at > now() - interval '30 days'
        or (status in ('deferred', 'dismissed') and decision_note is not null))
  order by decided_at desc nulls last;
  ```

  A `deferred` question with a note was put off by the person, and a
  `dismissed` one turned down; the note says why. Their notes bind the
  agenda and the pack as much as a decision does.
- **Decisions.** A question `decided` since the last meeting is settled:
  `decided_option` and `decision_note` are the person's. Do not debate it
  again unless something in this week's pack changes it, and open `since`
  with what each decision changes. Where they decided against the board's
  `verdict.recommended`, say so plainly and take it as information about
  what they weigh, not as an error.
- **Waiting on them.** A question still `discussing` from an earlier meeting
  has a verdict the person has not acted on. Name it in `since`; do not
  debate it again.
- **Older meetings.** A meeting held before the board debated questions has
  `disagreements` and `resolutions` in its minutes and the person's marks on
  them: a `vote` names the seat they sided with, the `answer` mark answers
  its `question`, and a `resolution` mark is `done` or `open`. Read them the
  same way, as what the person already knows and did.

No ready meeting means this is the first: say so in `since` and start the
scorecard at zero.

## 2. Set the agenda

At most three questions. With a `questions` line in the brief, read those
rows (`id` and `user_id` both in the where) and take them in that order;
skip one that is `decided` or `dismissed`, and say so in `chair_note`.
Otherwise fill the three places in this order, oldest first within each:

1. The person's own: `source = 'person'` and `status = 'queued'`.
2. Suggestions they accepted: `source` is `suggested` or `board`, and
   `status = 'queued'`.
3. The board's pick: if a place is left, the one question still
   `suggested` that this week's pack makes most pressing. Take one at most,
   and only when the pack gives the board something to argue about.

```sql
select id, question, options, context, lean, advisors, source, status, created_at
from you.board_questions
where user_id = '<user_id>' and status in ('queued', 'suggested') and meeting_id is null
order by (source = 'person') desc, (status = 'queued') desc, created_at;
```

A question that waits past three places stays `queued` for the next
meeting. A `deferred` question comes back only when the person queues it
again.

A called meeting with no `questions` line comes from the old call-a-meeting
form, which sent only the decision. Write it as one question first, with the
options you read in it (step 4), and record the insert:

```sql
insert into you.board_questions (user_id, question, options, source, status, meeting_id)
values ('<user_id>', $q$<the decision, as a question>$q$,
        $o$[{"letter":"A","text":"…"},{"letter":"B","text":"…"}]$o$::jsonb,
        'person', 'discussing', '<meeting id>')
returning id;
select core.record_dash_action('<user_id>', 'you.board_questions:<id>', 'insert',
  'board_question', $s$Dash put your decision "<decision>" to the board as a question.$s$);
```

Claim each agenda question for this meeting:

```sql
update you.board_questions set status = 'discussing', meeting_id = '<meeting id>'
where id = '<question id>' and user_id = '<user_id>';
```

No question at all (nothing queued, nothing suggested, nothing pressing in
the pack) is a meeting with no debate: skip steps 4 to 8, still write the
dream, the predictions and the scorecard, and suggest questions in step 10
so the next meeting has an agenda.

## 3. Build the pack

One file, `week.md` in your scratchpad, that every advisor reads, so they
argue from the same facts. Every fact carries its count or quote, its date
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
- **Learning.** What they studied and saved in Learn this week.
- **Building.** `git log --since="7 days ago" --oneline | wc -l` in this
  repository, and `public.plan_items` closed this week for the owner. Time
  spent building the app is a fact for every advisor to read, not only the
  skeptic.
- **Money.** `public.orders` totals by week (`total_cents`, `order_date`,
  `deleted_at is null`), the largest few, and `public.recurring_payments`.
- **Attention.** `core.page_view_days` opens by workspace this week against
  the month; what they asked Ask Dash (`core.conversation_turns`, role
  `user`), as short quotes.
- **What they wrote.** The journal's dated entries and the daily notes from
  this week, in full (`obsidian.notes.dated_entries` and paths ending in a
  date, as `.claude/skills/insights/SKILL.md` step 2 reads them).

Then one section per agenda question, `## Q1`, `## Q2`, `## Q3`, holding
what step 4 found for it. Mark any number you could not get, rather than
guessing it.

## 4. Prepare each question

Before a question is debated, the chair checks it has four things, and
fills what it can from the person's rows:

- **Options.** Two to five, lettered `A`, `B`, `C` in `options`. If the
  person gave none, write the options the question plainly implies (doing
  it, not doing it, and the middle way they wrote about, if any), always
  including the one they would take by doing nothing. Writing options into
  their row is the one change you make to a question they wrote; record it:

  ```sql
  select core.dash_before('you.board_questions:<id>');
  update you.board_questions
  set options = $o$[{"letter":"A","text":"…"},{"letter":"B","text":"…"}]$o$::jsonb
  where id = '<id>' and user_id = '<user_id>';
  select core.record_dash_action('<user_id>', 'you.board_questions:<id>', 'update',
    'board_question_options', $s$Dash wrote the options for your board question "<question>".$s$);
  ```

- **Real numbers.** What each option costs and earns, in money and in hours,
  read from their rows: salary ranges on the roles, their spending and
  recurring payments, hours from the plan and the calendar. A number you
  could not find is marked unknown, never estimated without saying so.
- **Limits.** What constrains the choice: deadlines, money they cannot
  spend, commitments already made, from their goals, todos and notes.
- **What success looks like.** In their words where they wrote it (a goal's
  done-when, a note), otherwise the chair's reading, labelled as such.

Write all four into the question's section of `week.md`, with the person's
`context` quoted first. Leave their `question`, `context` and `lean` as they
wrote them.

**The lean.** If `lean` is set, the section says it in one line: "You lean
toward B: <their words>." Every advisor is told to test the lean, not to
agree with it: find the strongest case against it before backing it. A lean
nobody tested is the groupthink round 2 exists to break.

## 5. Seat the board

The five seats, and the guests chosen as **The advisors** says. Read the
roster:

```sql
select id, key, name, kind, question, focus, brain, brain_status, active
from you.board_advisors
where user_id = '<user_id>' and active
order by kind desc, created_at;
```

Send one subagent per advisor, all in one message, and keep each one for
the whole meeting: continue it with SendMessage for rounds 2 and 3, so it
keeps its own reading and remembers what it said. Where the session cannot
continue a subagent, brief a new one each round with everything that advisor
said before. With no tool for subagents at all, write each advisor's turns
yourself in turn, finishing one before reading the next advisor's brief.

Each advisor's first message holds its paragraph (a seat's from **The
advisors**, or the guest paragraph and its brain), its `question`, the path
to `week.md`, the reading rules above, which agenda questions it sits on,
and the round 1 instruction below. Advisors may run their own owner-scoped
selects through `npx tsx scripts/sql.ts` to check something, and nothing
else; they never write.

## 6. Round 1: scores

> Read week.md in full. For each question you sit on, score every option
> from 1 to 10, where 10 is the option you would take. For each option give
> the reason for its score in one or two sentences, with the evidence that
> shows it (counts, dates, quotes, with the row id or note path in
> brackets). Then say in one line which option you back and why. If the
> person has a lean, test it: give the strongest case against it before you
> back it or not. At most 250 words per question, in your own voice, to the
> person as "you". Label anything you infer rather than read as a hunch.
> Answer as JSON per question: { "question": "Q1", "scores": { "A": 7, … },
> "text": "…", "receipts": [ { "label": "…", "link": "…" } ] }.

Write each advisor's turn as it lands, one insert per turn, `round = 1`,
`kind = 'opening'`, `addressed_to` null, and the next `position` in the
meeting:

```sql
insert into you.board_turns
  (user_id, meeting_id, question_id, round, advisor_id, addressed_to, kind, text, scores, receipts, position)
values (
  '<user_id>', '<meeting id>', '<question id>', 1,
  (select id from you.board_advisors where user_id = '<user_id>' and key = '<advisor key>'),
  null, 'opening', $t$<text>$t$,
  $j${"A": 7, "B": 4}$j$::jsonb,
  $r$[{"label": "…", "link": "…"}]$r$::jsonb,
  (select coalesce(max(position) + 1, 0) from you.board_turns
   where meeting_id = '<meeting id>' and user_id = '<user_id>')
);
```

`scores` holds every option's letter and nothing else, each a whole number
from 1 to 10. A turn that comes back without them is sent back to its
advisor once; it is not written without them. Link evidence where it opens
in the app: a note at `/vault/n/<path, each segment URL-encoded>`, a role at
`/jobs/roles/<id>`, a goal at `/goals/<id>`. A guest's brain source keeps
its own link.

## 7. Round 2: exchanges

Read the round 1 scores for each question and pair advisors who disagree:
two advisors back different options, or score the same option four or more
apart. Make two to four pairs per question, taking the widest gaps first,
and put the dreamer against the advisor whose scores leave it the least
room. Every advisor on the question speaks in round 2 at least once: one
left unpaired answers the advisor it disagrees with most.

Each pair makes at least two exchanges: A answers B, B answers A, A answers
B, B answers A. Send each turn to its advisor with the turn it answers:

> <Name> said to the board: "<their round 1 text or last reply>". Answer
> <Name> by name, in at most 120 words: the point you most disagree with and
> why, with evidence, or the point that moves you and how far. If it moves
> your scores, give the new ones.

Write each reply as it lands: `round = 2`, `kind = 'reply'`, `addressed_to`
the advisor answered (by the same key subquery), `scores` the new scores if
they moved and null if not. A turn's text names the advisor it answers in
its first sentence ("Mentor, you count the title and not the work.").

**When round 1 is unanimous,** every advisor backing the same option, the
board has not tested it. Choose two advisors, the skeptic and the one whose
job most bears on the option nobody backed, and have them argue for that
option in round 2, each against a named advisor who backed the shared one.
Their turns open "Arguing for B, which nobody backed:" so the reader knows
it is a brief and not their view, and the others answer them as above. The
same holds when the board agrees with the person's lean without anyone
having made the case against it.

## 8. Round 3: the vote

Send every advisor on the question the round 2 exchanges it was not part of,
then:

> Final vote. Score every option again from 1 to 10, say which option you
> back, and in at most 80 words why, naming anything in round 2 that moved
> you or did not. Same JSON as round 1.

Write each as it lands: `round = 3`, `kind = 'vote'`, `addressed_to` null,
`scores` every option.

## 9. Chair

You are the chair. You do not have a seat's view; you decide what the
person reads.

**A verdict for each question.** From the round 3 votes:

- `recommended`: the option letter the board recommends. Usually the one
  with the highest mean round 3 score; where the seats' and the guests'
  votes split, or one advisor's evidence outweighs the count, say why in the
  verdict's first condition.
- `conditions`: one to three conditions the recommendation rests on, each
  something the person can check ("only if the offer is above 95,000").
- `dissent`: every advisor whose round 3 vote backs another option, with one
  sentence of why in their terms.
- `would_change`: one to three facts that, if they turned out otherwise,
  would change the recommendation.
- `scores`: each advisor's round 3 scores, `{ advisor: <key>, scores: { … } }`.

```sql
select core.dash_before('you.board_questions:<id>');
update you.board_questions
set verdict = $v${"recommended": "B", "conditions": ["…"], "dissent": [{"advisor": "cfo", "text": "…"}],
                  "would_change": ["…"], "scores": [{"advisor": "mentor", "scores": {"A": 4, "B": 8}}]}$v$::jsonb
where id = '<id>' and user_id = '<user_id>';
select core.record_dash_action('<user_id>', 'you.board_questions:<id>', 'update',
  'board_verdict', $s$The board recommends B on "<question>".$s$);
```

The question stays `discussing` with its verdict until the person decides on
the tab; never set `decided`, `decided_option` or `decided_at`.

**Keep the dream on the table.** Every meeting has a `dream`: the dream the
debate came closest to dropping, in the person's own words with its date,
and the smallest thread this week that keeps it going, from the dreamer's
turns.

**Grade last meeting's predictions** against this week's pack: `hit`,
`miss` or `can't tell`, one line each with the fact that settles it. Add
them to the scorecard carried from the last minutes (hits and misses per
seat, since the first meeting). From the fourth meeting on, say in one line
whose read has been most often right.

**Collect this meeting's predictions.** Ask each of the five seats, in the
same subagent, for one prediction for the coming week that next week's facts
can check, tied to a question it voted on where it can be. Guests do not
predict; the scorecard is the seats'.

**Filter hard.** A number goes in a verdict or the minutes only if it came
from a query run in this meeting. Cut any condition the person could not
check, and any dissent that only restates a score.

## 10. Suggest new questions

Every meeting leaves three to five new questions for the person to accept or
dismiss, drawn from the week's pack, their goals and their notes. Spread
them across work, money, learning, projects, where and how they live, and
time; no two from the same area unless the pack gives nothing for the
others. Each is a decision they face now or soon, with two to four lettered
options, a `context` of one to three sentences saying what in the pack
raised it (with dates), and the advisors who should hear it in `advisors`
where one fits plainly. Never suggest a question about relationships, health
or family; never repeat one already `suggested`, `queued`, `deferred` or
`dismissed`.

```sql
insert into you.board_questions (user_id, question, options, context, advisors, source, status)
values ('<user_id>', $q$Should you take the contract role at Acme while you keep searching?$q$,
        $o$[{"letter":"A","text":"Take it"},{"letter":"B","text":"Turn it down"}]$o$::jsonb,
        $c$The recruiter wrote on 21 October with a three-month contract; your runway note says four months.$c$,
        '{cfo,hiring_manager}', 'board', 'suggested')
returning id;
```

A suggestion is the board's own proposal, waiting on the person, so it is
not recorded as a change to their rows. `meeting_id` stays null until a
meeting debates it; the minutes list the ids under `suggested`.

## 11. Write the minutes

The minutes are one jsonb object in the meeting row. The debate lives in
the turns and the verdicts; the minutes hold what spans the meeting:

```
agenda         [ question id ], in the order debated
suggested      [ question id ], the questions step 10 wrote
since          text: what the person's decisions since the last meeting
               change; or that this is the first meeting
dream          { text, thread, receipts: [ { label, link } ] }, in every
               meeting
predictions    [ { seat, text } ], the five seats; predictions_note?
graded         [ { seat, text, grade: 'hit'|'miss'|'cant_tell'|'pending',
                 fact? } ], last meeting's predictions; graded_note? when
                 there are none ("None. This is the first meeting.")
scorecard      [ { seat, hits, misses } ], all five seats
disagreements  [ { key: 'd1', point, positions: [ { seat, stance, text,
                 receipts } ] } ], one per agenda question, for the tab
                 until it reads the turns
chair_note     text?: who sat and why, guests left out and why, questions
               skipped
```

`seat` is `hiring_manager`, `mentor`, `skeptic`, `cfo` or `dreamer`, always
spelled that way. In `disagreements`, `point` is the question, and each of
the five seats has one position: `stance` its round 3 vote in a few words
("Backs B, 8 of 10"), `text` its round 3 reason. Keys run `d1`, `d2`, `d3`
in agenda order. Do not write `question`, `resolutions` or `memos`; the
board's question is now each verdict, and the person decides on the tab.

```sql
select core.dash_before('you.board_meetings:<meeting id>');
update you.board_meetings
set status = 'ready', held_on = '<yyyy-mm-dd>', finished_at = now(), error = null,
    minutes = $m${ ... }$m$::jsonb
where id = '<meeting id>' and user_id = '<user_id>';
select core.record_dash_action('<user_id>', 'you.board_meetings:<meeting id>',
  'update', 'board_meeting', $s$Dash held the board meeting of <d Mon yyyy> on <n> questions.$s$);
```

`held_on` is today's date.

**Read it back.** The meeting is `ready`. For each agenda question,
`you.board_turns` holds a round 1 opening and a round 3 vote from every
advisor who sat on it, each with every option scored, and round 2 replies
with `addressed_to` set, at least two each way between every pair; the
question is `discussing` with a `verdict` whose `scores` name every advisor
who voted. Three to five questions are `suggested` with this meeting's ids
in `minutes.suggested`. `minutes` has five `predictions` and five
`scorecard` rows.

```sql
select question_id, round, kind, count(*) as turns, count(addressed_to) as addressed
from you.board_turns
where meeting_id = '<meeting id>' and user_id = '<user_id>'
group by question_id, round, kind order by question_id, round;
```

If a write fails on a constraint, fix it and send it again once; if it
still fails, mark the row failed as in **The brief** and say why.

End with a short report for the notification: that the board met, each
question with the option it recommends and how many advisors dissented, the
number of new suggestions, and the meeting's date.

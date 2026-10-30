---
name: board
description: Hold the person's board meeting over an agenda of their decisions. The chair takes up to three questions, triages each as a one-way or two-way door, and requires a success measure and a decide-by date (proposing them from the person's rows and asking under The board asks you when missing). A two-way door gets one or two advisors' quick take. A one-way door gets the full method - a separate pass widens and neutralises the options, each advisor sees them in its own shuffled order and answers its own assessment blind from its own slice of evidence with a probability, a 90% range and a 100-point budget per option (the skeptic and the dreamer on a different model), then the lean is revealed, the two most opposed advisors exchange at most two turns each (or one steelman when round 1 is unanimous), and every advisor writes a premortem from which the chair sets a tripwire. The verdict is the believability-weighted mean probability with the spread and the dissent in full, written to you.board_questions; turns go to you.board_turns and the minutes, a short digest on a weekly run, to you.board_meetings. Use when the weekly board task fires with "Follow .claude/skills/board/SKILL.md", when the Board tab fires it with "Board meeting <id>", or the user says "convene the board", "ask the board", or "what does the board think".
---

# The board

The board meets to help the person decide. Each meeting works an agenda of
at most three questions, each with options, a measure of success and a date
to decide by. Advisors with different jobs forecast each option blind, from
their own evidence, as a probability of meeting the measure by the date, so
their disagreement shows as numbers before anyone has heard anyone else.
Only then do they hear the person's lean, and the two who disagree most
answer each other. The chair writes a verdict for each question, weighted by
each advisor's track record, with the spread, the dissent in full, a
premortem, a tripwire and what would change it, and the person makes the
decision on the Board tab. Every turn is kept, so the person can read each
advisor's forecast and reasoning in full.

How much of this a question gets depends on its door. A two-way door, a
choice the person can easily undo, gets one or two advisors' quick take. A
one-way door gets everything.

**What you write:** the meeting row, the turns, and on each question
debated its door, success measure and decide-by date where they were
missing, its options where they were missing or widened, the order each
advisor saw them in, its premortem, tripwire and verdict; the status of a
tripwire that fell due; three to five new suggested questions; and one Dev
note when the advisors have stopped disagreeing. Nothing else: no other
rows, no code, no commits, no email, no posts, no vault note, nothing
deleted. You never set a question to `decided`; the person decides.

In anything the person reads, the assistant is **Dash**; never write
"Claude" in a turn, a verdict or the minutes. Write to
`docs/WRITING-GUIDE.md`: plain sentences, no slogans, no "not X, it's Y", no
em dashes for rhythm. Advisors talk to the person as "you" and to each other
by name.

## The advisors

Everyone who can sit is a row in `you.board_advisors`: `key`, `name`, `kind`
(`seat` or `guest`), `question` (the one question they own), `focus`, `brain`
and `brain_status`, and `active`.

**The five seats sit on every one-way door** (a two-way door gets one or
two advisors, step 6). Their keys are `hiring_manager`,
`mentor`, `skeptic`, `cfo` and `dreamer`. Give each its paragraph below word
for word, with its `question` from the row. A question's `seats_off` lists
seats the person turned off for that one question: leave those out of it and
brief the rest as usual. The `advisors` on a question may come from a panel
the person picked (you.board_panels), so it can name seats as well as guests;
a seat named there still sits as always, and only the guests in it are
brought in as the guests paragraph says.

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

**A seat speaks from its brain too.** Each seat's `brain` is built from the
research and practice behind its role (`advisor-brain.md`, **Seats**): the
assessment it owns, its rules, the evidence it asks for first, where it
parts from the other advisors and what it would never say. When a seat's
`brain_status` is `ready`, follow its paragraph with this line and the
`brain` object as it is in the row:

> Your brain is below: make its assessment of every option, from the
> evidence it asks for first, decide by its rules, ask its questions, and
> hold its disagreements unless the person's evidence moves you. Never say what it lists under `never`. When you lean
> on a rule or a finding, name its source.

A seat with no ready brain still sits, on its paragraph alone.

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
own use. It speaks from its `brain` (its assessment, questions, rules,
frameworks, positions, disagreements, stories, voice and sources, as
`.claude/skills/board/advisor-brain.md` describes them) and nothing else about the real person. It never claims to
be them, never invents a quote, and cites a brain source in `receipts` when
it leans on a rule, a position or a story. Brief a guest with this paragraph:

> You are <name>, as a persona built from your public work for one person's
> board. You own the question "<question>". Your brain is below: make its
> assessment of every option, ask for its evidence first, decide by its
> rules, reason with its frameworks, take its positions, hold its
> disagreements with the other advisors unless the evidence moves you, tell
> its stories where they fit, speak in its voice, and never say what it lists
> under `never`. Do not claim anything the
> brain does not hold, and never put words in the real person's mouth: when
> you lean on a rule, a position or a story, name its source. Argue from
> what this person actually did and wrote, in the slice you are given,
> and talk to them as "you".

followed by the `brain` object as it is in the row.

## A panel meeting

When the meeting row has a `panel_id`, the person started it for one panel.
The row holds everything about the panel as it was when they pressed the
button: `panel_name`, `panel_topic` (null means the topic is the panel's
name) and `panel_advisors`, an ordered array of advisor keys. Read these from
the meeting row, never from `you.board_panels`, which the person may have
edited since. With no `panel_id` nothing in this section applies and the
meeting runs as described everywhere else.

- **Who sits.** Exactly the advisors in `panel_advisors`, no more. The five
  seats sit only if their keys are listed, and guests are not added by fit:
  skip the "usable guests whose question and focus bear most" rule and the
  four-guest cap does not need to trim anything. A key is looked up in
  `you.board_advisors` (`key`, owner's `user_id`). One that is a guest
  with `brain_status` of `none`, `building` or `failed`, or not `active`,
  or has no row, does not sit, as the guest rule above says. The meeting
  goes ahead with the members who are ready. Name each one who could not sit
  in `chair_note`, with the reason ("Richard Feynman: his brain has not been
  built yet"), so the person sees the panel was short. If no member can sit,
  or fewer than two, mark the meeting failed (see **The brief**) with an
  error saying which brains are missing.
  The "five seats sit on every question" rule gives way to the panel: a
  seat missing from `panel_advisors` does not sit, so a panel can be guests
  and one or two seats. Write predictions only for the seats that sat (the
  others have none to grade next time), carry an absent seat's `scorecard`
  row over unchanged from the last meeting, and where the read-back asks for
  five of either, it means one per seat that sat.
- **What is debated.** Only questions within the topic (step 2).
- **What is read.** The pack covers what bears on the topic (step 3).
- **What is suggested.** Only questions within the topic (step 11).

## How you read

Through `npx tsx scripts/sql.ts` (CLAUDE.md, "Rows are written through
scripts/sql.ts"), every query filtered by the owner's
`user_id = :owner`. You run as the service
role, so the filter is the only thing keeping other accounts' rows out.
Check a column against `information_schema.columns` before relying on it,
and fix and resend a query that fails on a column name. For long SQL (every
turn, verdict and the minutes) write it to a scratchpad file and pass
`--file`, so quotes need no escaping. If node_modules is empty, run `npm ci`
first.

Notes: never read one whose `voice` is `secret`, or one whose title or path
names passwords or keys; skip
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
panel <panel id>
```

The `questions` line is there when the person called a meeting about
questions they named; those, in that order, are the whole agenda. Without
it the chair builds the agenda (step 2).

The `panel` line is there when the person started the meeting for a panel.
It repeats the meeting row's `panel_id`; read the row for the rest, as **A
panel meeting** says. A brief without it is a meeting with no panel, unless
the row itself has a `panel_id`, in which case the row wins.

The scheduled Sunday task sends only "Follow .claude/skills/board/SKILL.md",
with no meeting named. Then insert your own weekly row first, as the owner,
and use its id:

```sql
insert into you.board_meetings (user_id, kind, status, started_at)
values (:owner, 'weekly', 'running', now())
returning id;
```

If it fails on `board_meetings_one_open`, a meeting is already queued or
running: read it, and if it is `queued` take it as yours, otherwise stop and
say so. Never start a second.

With a meeting named, read its row (`id` and `user_id` both in the where),
including `panel_id`, `panel_name`, `panel_topic` and `panel_advisors`. If
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
3. **Build the pack**: the week for the chair, and one slice per advisor.
4. **Prepare each question**: the door, the success measure and the
   decide-by date, numbers and limits.
5. **Widen the options** of every one-way door.
6. **Seat the board**: who sits, and on which model.
7. **Round 1, blind**: every advisor forecasts every option.
8. **The lean, and one exchange**: the lean is revealed, the two most
   opposed answer each other, or one steelman when round 1 is unanimous.
9. **Premortem and tripwire** for every one-way door.
10. **Chair**: the weighted verdict, the spread, the check-backs and
    tripwires that fell due, the dream, predictions, scorecard.
11. **Suggest** three to five new questions.
12. **Write the minutes** and read everything back.

A two-way door takes the quick path: steps 4, 6 and 7 with one or two
advisors, then the verdict in step 10. Steps 5, 8 and 9 are for one-way
doors only.

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
step 10) and its `dream`. Then:

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
- **Answers to the board's questions, read first.** The board leaves
  questions for the person on the question they are about (`asks`, step 4).
  Read every ask that has an answer no meeting has read yet:

  ```sql
  select q.id, q.question, q.status, q.success_measure, q.decide_by,
         q.verdict->'assumptions' as assumptions, a.ask
  from you.board_questions q, jsonb_array_elements(q.asks) as a(ask)
  where q.user_id = '<user_id>' and q.status <> 'dismissed'
    and a.ask->>'answer' is not null and a.ask->>'read_in' is null;
  ```

  Treat each answer as a fact from the person, ahead of the pack. An answer
  to a proposed success measure or decide-by date (step 4) replaces the
  proposal on the row. If a question's verdict listed an assumption the
  answer overturns, that question comes back to the agenda (step 2). After
  the meeting's questions are written, mark each answer read (step 10).
- **Decisions.** A question `decided` since the last meeting is settled:
  `decided_option` and `decision_note` are the person's. Do not debate it
  again unless something in this week's pack changes it, and open `since`
  with what each decision changes. Where they decided against the board's
  `verdict.recommended`, say so plainly and take it as information about
  what they weigh, not as an error.
- **Check-backs that fell due.** The board checks back on every decision 30
  and 90 days after `decided_at` (step 10, "Check back on decisions"). Find
  the ones due today and not yet written:

  ```sql
  select q.id, q.question, q.options, q.decided_option, q.decision_note, q.decided_at,
         q.topic, q.verdict->'scores' as scores, d.at
  from you.board_questions q, (values (30), (90)) as d(at)
  where q.user_id = '<user_id>' and q.status = 'decided'
    and q.decided_at + make_interval(days => d.at) <= now()
    and not exists (select 1 from jsonb_array_elements(q.reviews) r where (r->>'at')::int = d.at)
  order by q.decided_at;
  ```

  A 90-day check-back that is due while its 30-day one was never written
  gets both, written by this meeting. Take each into the pack (step 3) and
  write it in step 10. Answers to earlier check-backs (`outcome` set) are
  the person's verdict on how a decision went: read them as facts like any
  other.
- **Tripwires that fell due.** Every one-way door leaves a tripwire (step 9)
  with the date to check it on. Find the ones still watching whose date has
  come:

  ```sql
  select id, question, status, decided_option, tripwire
  from you.board_questions
  where user_id = '<user_id>' and tripwire->>'status' = 'watching'
    and (tripwire->>'check_on')::date <= current_date
  order by (tripwire->>'check_on')::date;
  ```

  Check each in step 10.
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

**The weekly meeting is a short digest.** A meeting of kind `weekly` with
no `questions` line and no `panel_id` (the Sunday task, or Start a meeting
with no panel) works only what the person asked for: their own queued
questions, then suggestions they accepted, oldest first within each, three
at most. It never adds the board's pick. With nothing queued it debates
nothing and is the digest alone (step 12): what changed since, the
check-backs and tripwires that fell due, what waits on the person, the
dream and the suggestions. Most weeks that is the whole meeting.

A called meeting with no `questions` line, and a panel meeting, fill the
three places in this order, oldest first within each:

1. The person's own: `source = 'person'` and `status = 'queued'`.
2. Suggestions they accepted: `source` is `suggested` or `board`, and
   `status = 'queued'`.
3. The board's pick: if a place is left, the one question still
   `suggested` that this week's pack makes most pressing. Take one at most,
   and only when the pack gives the board something to argue about.

**For a panel meeting** (the row has a `panel_id`), the topic is
`panel_topic`, or `panel_name` where that is null. Run the same three places
over the questions that fall within the topic, judged from the question,
its options and its `context`; a question outside the topic stays where it
is for the next ordinary meeting, and `chair_note` says how many were left.
The person's queued questions on the topic come first, then accepted
suggestions on it, then the board's pick, which is a `suggested` question
within the topic, or, if none is there and the pack gives something to
argue about, a new question you write on the topic (insert it as step 11
does and take it, so the pick is never off-topic). A `questions` line in the
brief still decides the agenda by itself. A panel meeting with nothing on its
topic is a meeting with no debate (below): it still suggests questions on the
topic in step 11.

```sql
select id, question, options, context, lean, lean_probability, advisors, seats_off,
       door, success_measure, decide_by, source, status, created_at
from you.board_questions
where user_id = '<user_id>' and status in ('queued', 'suggested') and meeting_id is null
order by (source = 'person') desc, (status = 'queued') desc, created_at;
```

**Reopening.** A question whose verdict named an assumption that a new
answer overturns, or whose tripwire step 10 finds tripped, goes on the
agenda ahead of the three places, even if it is `discussing`, `deferred` or
`decided`. Put it back, keeping the old verdict and the person's earlier
choice in the row, and say in `chair_note` which answer or tripwire reopened
it and what the earlier decision was:

```sql
select core.dash_before('you.board_questions:<id>');
update you.board_questions
set status = 'queued', meeting_id = null, decided_at = null
where id = '<id>' and user_id = '<user_id>' and status in ('discussing', 'deferred', 'decided');
select core.record_dash_action('<user_id>', 'you.board_questions:<id>', 'update',
  'board_question_reopened', $s$Dash reopened "<question>" because your answer changes an assumption.$s$);
```

A question the person decided is reopened only when the answer plainly
contradicts an assumption the verdict rested on, or its tripwire tripped;
otherwise their decision stands. Then claim it as below.

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

No question at all is a meeting with no debate: skip steps 4 to 9, still
check the tripwires and write the dream, the predictions and the scorecard,
and suggest questions in step 11 so the next meeting has an agenda.

## 3. Build the pack

The pack is in two parts, so that each advisor forecasts from its own
evidence and nobody reads the same page as everyone else.

**`week.md`, the chair's.** Everything below, for you: the digest, the
check-backs, the tripwires, the suggestions and the predictions are written
from it. Advisors do not read it before round 1. Every fact carries its
count or quote, its date and the table and row id or the note path it came
from. Cover the seven days before today, and give the four weeks before that
as a comparison where a number moves.

- **Who they are, briefly.** From the notes the person wrote about
  themselves (in the journal folders, `journal_folders` on their
  obsidian.vault_connections row: an about-me note, personal goals, an index of
  interests, notes to self, whatever they are called): ten lines at most,
  quoted, so the advisors know what the person says they want.
- **How they tend to work.** The newest analysis across their personality
  tests, from the Personality tab:

  ```sql
  select summary, agreements, tensions, watch, created_at
  from you.personality_profiles
  where user_id = '<user_id>'
  order by created_at desc
  limit 1;
  ```

  Give the summary, each tension with its verdict, and each pattern under
  `watch` with its number, dated by `created_at`. It is Dash's reading of the
  tests, not the person's words: say so, and let the record outweigh it.
  With no row, leave the section out.
- **Dreams.** For the dreamer, quotes with dates of ambitions, projects and
  "someday" lines from the journal folders, the journal and daily notes, any note in Ideas/
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
  repository, and `public.plan_items` closed this week for the owner.
- **Money.** `public.orders` totals by week (`total_cents`, `order_date`,
  `deleted_at is null`), the largest few, and `public.recurring_payments`.
- **Attention.** `core.page_view_days` opens by workspace this week against
  the month; what they asked Ask Dash (`core.conversation_turns`, role
  `user`), as short quotes.
- **What they wrote.** The journal's dated entries and the daily notes from
  this week, in full (`obsidian.notes.dated_entries` and paths ending in a
  date, as `.claude/skills/insights/SKILL.md` step 2 reads them).

**For a panel meeting**, read what bears on the topic rather than the whole
week. Keep the "Who they are" section and drop any other that has nothing to
say about the topic; put the weight on the sources that fit it. The panel's
topic is a guide, not a fixed list: Philosophy reads the private notes, the
journal and the vault themes; Money reads `public.orders` and
`public.recurring_payments`; Learning reads what they studied and saved in
Learn; Building reads the commits and `public.plan_items`; Career reads the
job search, goals and todos; Hobbies and Life read the dated notes, the
dreams and the daily notes. Name the topic at the top of `week.md`.

**One slice per advisor per question, `q<n>-<advisor key>.md`.** What that
advisor forecasts from, and all it reads in round 1. It holds:

1. **The decision**, the same for every advisor: the question, the options
   in that advisor's own order under neutral labels (step 6), the success
   measure, the decide-by date, the numbers and the limits from step 4, and
   any assumption the board debates on. The person's `context` is quoted
   with any line saying which option they prefer taken out. Never the lean,
   never `lean_probability`, never what another advisor said or will be
   asked.
2. **Its own evidence**: what its brain's `evidence` lines ask to see first,
   read fresh from the person's rows for this question, with the same
   receipts as `week.md`. With no ready brain, the evidence its seat
   paragraph names (the hiring manager the pipeline, the CFO the money, the
   skeptic stated priorities beside where the hours went, the mentor the
   long record of notes, learning and goals, the dreamer the dreams).
   The skeptic's and the mentor's slices also get the `watch` patterns and
   the tensions from the personality analysis in `week.md`, where one bears
   on the decision, so a known tendency (researching past the point of
   deciding, say) is asked about rather than assumed.
3. **Its memory**: its unretired `you.advisor_memory` rows, the oldest
   first, as what it already knows about the person.

```sql
select kind, text, created_at
from you.advisor_memory
where user_id = '<user_id>' and advisor_id = '<advisor id>' and retired_at is null
order by created_at;
```

Slices differ on purpose. A fact may sit in two slices where two advisors'
evidence lines both ask for it, never in every slice: when the same rows
would fill them all, give each advisor the part its assessment rates. Mark
any number you could not get, rather than guessing it. Then write one
section per agenda question in `week.md`, `## Q1`, `## Q2`, `## Q3`, with
the decision part and the lean, for your own use.

## 4. Prepare each question

**Triage the door first.** A `door` on the row is the person's and stands.
Where it is null, judge it and write it: `one_way` when the choice is hard or
costly to undo within the decide-by date plus three months (turning down an
offer, quitting, signing, moving, spending more than a month's spending, a
commitment of more than three months), otherwise `two_way`. When unsure,
`one_way`.

```sql
select core.dash_before('you.board_questions:<id>');
update you.board_questions set door = 'one_way'
where id = '<id>' and user_id = '<user_id>' and door is null;
select core.record_dash_action('<user_id>', 'you.board_questions:<id>', 'update',
  'board_question_door', $s$Dash judged "<question>" a one-way door: <why, in a clause>.$s$);
```

Then the chair checks the question has what a forecast needs, and fills
what it can from the person's rows:

- **Options.** Two to four lettered `A`, `B`, `C`, `D` in `options`. If the
  person gave none, write the options the question plainly implies (doing
  it, not doing it, and the middle way they wrote about, if any), always
  including the one they would take by doing nothing. Writing options into
  their row is a change to a question they wrote; record it:

  ```sql
  select core.dash_before('you.board_questions:<id>');
  update you.board_questions
  set options = $o$[{"letter":"A","text":"…"},{"letter":"B","text":"…"}]$o$::jsonb
  where id = '<id>' and user_id = '<user_id>';
  select core.record_dash_action('<user_id>', 'you.board_questions:<id>', 'update',
    'board_question_options', $s$Dash wrote the options for your board question "<question>".$s$);
  ```

- **The success measure and the decide-by date, both required.** Every
  advisor's probability is of meeting the measure by the date, so a
  question is not debated without both. Where the person left one empty,
  propose it from their rows (a goal's done-when, a target in a note, the
  salary floor they gave, a deadline in a role or an email): a measure is
  one sentence with a number someone can check later ("An offer at 90,000
  or more, signed"), and a date is a day. Write the proposal into the row,
  list it in the verdict's `assumptions` (step 10), and ask the person to
  confirm or correct it under The board asks you:

  ```sql
  select core.dash_before('you.board_questions:<id>');
  update you.board_questions
  set success_measure = coalesce(success_measure, $m$An offer at 90,000 or more, signed$m$),
      decide_by = coalesce(decide_by, '2026-12-15')
  where id = '<id>' and user_id = '<user_id>';
  select core.record_dash_action('<user_id>', 'you.board_questions:<id>', 'update',
    'board_question_measure', $s$Dash proposed how to judge "<question>": <measure>, by <d Mon yyyy>.$s$);
  ```

  with an ask such as "The board took success as an offer at 90,000 or more,
  signed by 15 December. Is that right, and if not, what is?". When the
  answer comes, the next meeting writes it over the proposal.
- **Real numbers.** What each option costs and earns, in money and in hours,
  read from their rows: salary ranges on the roles, their spending and
  recurring payments, hours from the plan and the calendar. A number you
  could not find is marked unknown, never estimated without saying so.
- **Limits.** What constrains the choice: deadlines, money they cannot
  spend, commitments already made, from their goals, todos and notes.

Leave their `question`, `context` and `lean` as they wrote them.

**Other missing facts: assume, then ask.** Never hold a meeting back for a
missing fact. When something else that would change the verdict is not in
the person's rows or in their `context` (a budget, a number only they know),
write it down as an assumption in the decision part of every slice, and
tell every advisor to forecast on it as stated. The assumption is one
sentence the person can read and say is wrong ("You need to be earning again
by February"). Only facts that would change the verdict count: not what the
pack could have found, and not what the person already answered.

Write one short question to the person per missing fact, the measure and
date included, each answerable in a line. Put them on the question's row in
`asks` (`id` a1, a2 and so on, unique within the question), keeping every
ask already there:

```sql
update you.board_questions
set asks = asks || $a$[{"id":"a1","text":"What do you need to earn each month to stay on this search?","asked_in":["<meeting id>"],"answer":null,"answered_at":null,"read_in":null}]$a$::jsonb
where id = '<id>' and user_id = '<user_id>';
```

An ask from an earlier meeting with no answer is asked again: append this
meeting's id to its `asked_in`, unless `asked_in` already holds three ids, in
which case leave it alone and do not ask it again. Do not write a new ask the
person already answered, and do not ask more than three in all for one
question, counting the open ones. Asks are the board's own questions to the
person, so they are not recorded as a change to their rows.

**The lean stays with you.** If `lean` or `lean_probability` is set, write
it in the question's section of `week.md` and nowhere else until step 8.

## 5. Widen the options (one-way doors)

A separate pass before anyone forecasts, run by one subagent that will not
sit on the question (or by you, before you brief any advisor). It works by
WRAP: widen the options, reality-test them, attain distance, prepare to be
wrong. Give it the question, the options, the measure, the date, the limits
and `week.md`, and ask it for:

- **At least one option the person did not list**, always: the option that
  combines two of theirs, the one that buys time or information first, the
  smallest test of the bold one, or the one a friend in their place would
  take. Never a second wording of an option already there.
- **Every option written neutrally**: the same form and about the same
  length, a verb first, no word that praises or warns ("safe", "bold",
  "finally"), and the do-nothing option named as what happens, not as
  "doing nothing".
- **Equal evidence**: for each option the same number of facts (two or
  three), from the rows, each with its receipt. These go in the decision
  part of every slice.

Five options at most in all. Write the widened options into the row,
keeping each of the person's letters on the option they wrote and giving
new ones the next letters, with `"added": true` on each the board added:

```sql
select core.dash_before('you.board_questions:<id>');
update you.board_questions
set options = $o$[{"letter":"A","text":"…"},{"letter":"B","text":"…"},{"letter":"C","text":"…","added":true}]$o$::jsonb
where id = '<id>' and user_id = '<user_id>';
select core.record_dash_action('<user_id>', 'you.board_questions:<id>', 'update',
  'board_question_options', $s$Dash widened the options on "<question>" with "<the added option>".$s$);
```

Rewording an option of theirs to be neutral changes their text: keep their
meaning, and say in `chair_note` which option you reworded and how.

## 6. Seat the board

Read the roster:

```sql
select id, key, name, kind, question, focus, brain, brain_status, active, believability
from you.board_advisors
where user_id = '<user_id>' and active
order by kind desc, created_at;
```

**Who sits.** On a one-way door, the five seats and the guests chosen as
**The advisors** says (or the panel's members). On a two-way door, the one
or two whose `assessment` bears most on the choice, from the same people,
with a line in `chair_note` saying why them. A two-way door gets their
quick take and nothing more.

**Order and labels.** Each advisor sees the options in its own random
order, labelled `1`, `2`, `3` in that order, so position and the person's
lettering cannot steer it. The added option and the do-nothing option are
not marked as such. Shuffle with

```sh
node -e "const a=process.argv.slice(1);for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}console.log(a.join(','))" A B C D
```

once per advisor, and record every order on the question, so a label maps
back to a letter (label `n` is the `n`th letter in that advisor's list):

```sql
update you.board_questions
set option_order = $j${"cfo": ["C", "A", "B"], "mentor": ["B", "C", "A"]}$j$::jsonb
where id = '<id>' and user_id = '<user_id>';
```

`option_order` is the board's own bookkeeping, so it is not recorded as a
change to the person's rows.

**Models.** The skeptic and the dreamer run on a different model from the
rest, so that the two seats most likely to disagree do not share one
model's habits. Give their subagents a different `model` from the one the
others use (if the others run on Opus, the skeptic and the dreamer run on
Sonnet; otherwise on Opus). Write the model each turn came from in the
turn's `model`.

**Briefing.** Send one subagent per advisor, all in one message, and keep
each one for the whole meeting: continue it with SendMessage for step 8 and
step 9, so it keeps its own reading and remembers what it said. Where the
session cannot continue a subagent, brief a new one with everything that
advisor said before. With no tool for subagents at all, write each
advisor's round 1 yourself, one at a time, from its slice alone, before you
open the next slice; such turns are not blind, so write `blind` false and
say so in `chair_note`.

Each advisor's first message holds its paragraph and its brain (a seat's
paragraph from **The advisors**, or the guest paragraph), the assessment it
answers (its brain's `assessment`; with no ready brain, its `question`),
the path to its slice and nothing else of the pack, the reading rules
above, which agenda questions it sits on, and the round 1 instruction
below. Advisors may run their own owner-scoped selects through
`npx tsx scripts/sql.ts` to check something in their own evidence, and
nothing else; they never write, and never read `week.md` or another
advisor's slice before step 8.

## 7. Round 1: blind forecasts

> Read your slice in full and nothing else. For each question you sit on,
> answer your own assessment, from your evidence, and give for every option
> by its label:
>
> - the probability, from 0 to 1, that taking it meets the success measure
>   by the decide-by date;
> - a 90% range for the measure's number under that option, with its unit
>   (where the measure has no number, the weeks until it is met);
> - a share of 100 points, spread over the options as you would bet them;
> - and, once for the question, what would change your mind.
>
> Probabilities are yours: they need not sum to 1, and two options can both
> be likely or both unlikely. Then say why, in at most 250 words to the
> person as "you", with the evidence that shows it (counts, dates, quotes,
> with the row id or note path in brackets). Label anything you infer rather
> than read as a hunch. Answer as JSON per question: { "question": "Q1",
> "assessment": "<its name>", "probabilities": { "1": 0.6, … }, "ranges":
> { "1": { "low": 80000, "high": 95000, "unit": "salary" }, … }, "budget":
> { "1": 60, … }, "change_mind": "…", "text": "…", "receipts": [ { "label":
> "…", "link": "…" } ] }.

Map each label back to its letter through `option_order` before writing.
Check the turn: a probability for every option between 0 and 1, a range
with low at or below high for every option, whole budget points summing to
exactly 100, and a `change_mind`. A turn that fails is sent back to its
advisor once; it is not written without them.

On a two-way door, ask for at most 120 words instead of 250; that turn is
the quick take.

Write each turn as it lands, one insert per turn, `round = 1`,
`kind = 'opening'`, `blind = true`, `addressed_to` null, and the next
`position` in the meeting. `scores` carries the probabilities on the old
1 to 10 scale, `round(1 + 9 * p)` per option, so the meeting page in use
today still draws its grid:

```sql
insert into you.board_turns
  (user_id, meeting_id, question_id, round, advisor_id, addressed_to, kind, text,
   probabilities, ranges, budget, change_mind, assessment, model, blind, scores, receipts, position)
values (
  '<user_id>', '<meeting id>', '<question id>', 1,
  (select id from you.board_advisors where user_id = '<user_id>' and key = '<advisor key>'),
  null, 'opening', $t$<text>$t$,
  $j${"A": 0.62, "B": 0.35, "C": 0.4}$j$::jsonb,
  $j${"A": {"low": 80000, "high": 95000, "unit": "salary"}, "B": {"low": 0, "high": 70000, "unit": "salary"}, "C": {"low": 60000, "high": 90000, "unit": "salary"}}$j$::jsonb,
  $j${"A": 55, "B": 15, "C": 30}$j$::jsonb,
  $c$<what would change their mind>$c$, $s$<the assessment's name>$s$, '<model id>', true,
  $j${"A": 7, "B": 4, "C": 5}$j$::jsonb,
  $r$[{"label": "…", "link": "…"}]$r$::jsonb,
  (select coalesce(max(position) + 1, 0) from you.board_turns
   where meeting_id = '<meeting id>' and user_id = '<user_id>')
);
```

The table checks the shapes (`board_turns_probabilities_ck`,
`board_turns_ranges_ck`, `board_turns_budget_ck`, and `blind` only in
round 1). Link evidence where it opens in the app: a note at
`/vault/n/<path, each segment URL-encoded>`, a role at `/jobs/roles/<id>`,
a goal at `/goals/<id>`. A guest's brain source keeps its own link.

Do not pass any advisor's answer to another until every round 1 turn on
the question is written.

## 8. The lean, and one exchange (one-way doors)

**The lean is revealed.** If the person gave a `lean` (or a
`lean_probability`), send it to every advisor on the question:

> You have all answered. The person leans toward "<the option's text>"
> (option <their label for it>)<, and gives it a <p> chance of meeting the
> measure>: "<their words>". In one line, does this move you, and why? If it
> moves your forecast, give the new probabilities and budget, same JSON.

Write each answer as it lands: `round = 2`, `kind = 'reply'`,
`addressed_to` null, the text opening "On your lean:", with
`probabilities`, `budget` and `scores` only when it moved them (and null
otherwise), `model`, `assessment` and `blind` false. A lean nobody tested
is what round 1 being blind exists to prevent, so the lean never reaches an
advisor before its round 1 is written.

**One exchange, between the two most opposed.** Take each advisor's latest
probabilities. The two most opposed are the pair with the largest sum,
over the options, of the gap between their probabilities; where pairs tie,
the pair whose budgets put the most points on different options. Send each
the other's round 1 text and latest numbers:

> <Name> said: "<their round 1 text>", and gives <their numbers by your
> labels>. Answer <Name> by name, in at most 120 words: the point you most
> disagree with and why, from your evidence, or the point that moves you and
> how far. If it moves your forecast, give the new probabilities and budget.

Then each may answer the other's reply once: at most two turns each, four
in all, and stop early when one has nothing new to say. Write each reply:
`round = 2`, `kind = 'reply'`, `addressed_to` the advisor answered (by the
same key subquery), the new numbers if they moved and null if not. A
turn's text names the advisor it answers in its first sentence ("Mentor,
you count the title and not the work."). No other advisor speaks in the
exchange.

**When round 1 is unanimous,** every advisor's budget giving the most
points to the same option, the board has not tested it. Instead of the
exchange, assign one steelman: the advisor whose round 1 gave the next
option its highest probability argues for that option, as a brief, against
the advisor who put the most points on the shared pick, who answers once.
The brief's text opens "Arguing for <letter>, which nobody backed:" so the
reader knows it is an assignment and not that advisor's view; its turn
carries no numbers, and the answer carries new numbers only if they moved.

On a two-way door none of this happens: no lean is revealed to the
advisors and nobody answers anybody.

## 9. Premortem and tripwire (one-way doors)

Before the verdict, take the option with the highest weighted probability
(the query in step 10) and ask every advisor on the question:

> It is a year after <the decide-by date>. You took "<that option>" and it
> went badly. In at most 60 words, say what happened, as the most likely
> story from your evidence, and the earliest sign the person could have
> seen. JSON: { "text": "…", "signal": "…" }.

Write the stories on the question as `premortem`, one per advisor by key,
with no record call (they are the board's, like the verdict's dissent):

```sql
update you.board_questions
set premortem = $p$[{"advisor": "cfo", "text": "…", "signal": "…"}, {"advisor": "skeptic", "text": "…", "signal": "…"}]$p$::jsonb
where id = '<id>' and user_id = '<user_id>';
```

**The tripwire.** From the signals, choose the one most likely to show
first that can be checked in the person's rows, and write it as the
condition that reopens the decision: a sentence with a number, a table to
read it from and a date to check it on, between two weeks and three months
after the decide-by date ("Fewer than two first interviews from the
applications sent in December, by 31 January, in job_search.interviews").

```sql
update you.board_questions
set tripwire = jsonb_build_object('condition', $w$…$w$, 'check_on', '2027-01-31', 'status', 'watching')
where id = '<id>' and user_id = '<user_id>';
```

## 10. Chair

You are the chair. You do not have a seat's view; you decide what the
person reads.

**Name each question's topic** first, as `topic = '<topic>'`: one of
`work`, `money`, `learning`, `projects`, `place` (where and how they live)
or `time`, the area the decision changes most. The weights read it.

**The weighted verdict.** Each advisor's forecast is its latest turn on the
question with probabilities. Its weight is its believability on the
question's topic: 1 until at least five of its forecasts on that topic were
scored, then `(0.5 - brier) / 0.25` held between 0.25 and 2, so a mean
Brier of 0.25 (no better than a coin) weighs 1, a better one more, a worse
one less. The spread of an option is the gap between the highest and lowest
blind round 1 probability given it. This query gives both per option:

```sql
with last as (
  select distinct on (t.advisor_id) t.advisor_id, a.key, t.probabilities,
         case when coalesce((a.believability -> '<topic>' ->> 'scored')::int, 0) >= 5
              then greatest(0.25, least(2, (0.5 - (a.believability -> '<topic>' ->> 'brier')::numeric) / 0.25))
              else 1 end as weight
  from you.board_turns t
  join you.board_advisors a on a.id = t.advisor_id and a.user_id = t.user_id
  where t.user_id = '<user_id>' and t.meeting_id = '<meeting id>' and t.question_id = '<question id>'
    and t.probabilities is not null
  order by t.advisor_id, t.position desc
), blind as (
  select b.key as letter, max(b.value::numeric) - min(b.value::numeric) as spread
  from you.board_turns t, jsonb_each_text(t.probabilities) b
  where t.user_id = '<user_id>' and t.meeting_id = '<meeting id>' and t.question_id = '<question id>'
    and t.blind
  group by b.key
)
select e.key as letter,
       round(sum(l.weight * e.value::numeric) / sum(l.weight), 3) as probability,
       round(min(blind.spread), 3) as spread,
       jsonb_object_agg(l.key, round(l.weight, 2)) as weights
from last l
cross join jsonb_each_text(l.probabilities) e
left join blind on blind.letter = e.key
group by e.key order by e.key;
```

Write the verdict from it:

- `method`: `full` for a one-way door, `quick` for a two-way door.
- `recommended`: the option with the highest weighted probability. Where
  two are within 0.05, or the advisor whose assessment bears most on the
  choice backs the other, say which and why in the first condition.
- `probability`: the weighted mean per option, `{ "A": 0.58, … }`.
- `spread`: per option, `{ "A": 0.35, … }`, and `spread_max`, the largest.
  On a `full` verdict only.
- `forecasts`: each advisor's final numbers,
  `{ advisor: <key>, probabilities, budget, weight }`.
- `scores`: the same on the 1 to 10 scale, `{ advisor: <key>, scores }`,
  for the page in use today.
- `conditions`: one to three conditions the recommendation rests on, each
  something the person can check ("only if the offer is above 95,000").
- `dissent`: every advisor whose budget puts the most points on another
  option, in full: their reasoning as they wrote it in their latest turn,
  not a summary, as `{ advisor, option, text }`. Dissent is what the person
  most needs to read; never shorten it to a clause.
- `would_change`: one to three facts that, if they turned out otherwise,
  would change the recommendation, drawn from the advisors' `change_mind`.
- `assumptions`: every assumption the forecasts rested on, the proposed
  measure and date included, as the sentences the advisors were given.
  Leave it out when none was made.
- `steelman`: on a unanimous question, `{ advisor, option }` of the brief.

```sql
select core.dash_before('you.board_questions:<id>');
update you.board_questions
set topic = '<topic>',
    verdict = $v${"method": "full", "recommended": "B", "probability": {"A": 0.41, "B": 0.58},
                  "spread": {"A": 0.3, "B": 0.45}, "spread_max": 0.45,
                  "forecasts": [{"advisor": "mentor", "probabilities": {"A": 0.3, "B": 0.7}, "budget": {"A": 25, "B": 75}, "weight": 1}],
                  "scores": [{"advisor": "mentor", "scores": {"A": 4, "B": 7}}],
                  "conditions": ["…"], "dissent": [{"advisor": "cfo", "option": "A", "text": "…"}],
                  "would_change": ["…"], "assumptions": ["…"]}$v$::jsonb
where id = '<id>' and user_id = '<user_id>';
select core.record_dash_action('<user_id>', 'you.board_questions:<id>', 'update',
  'board_verdict', $s$The board recommends B on "<question>".$s$);
```

Then, for each agenda question, mark the answers this meeting read, so the
tab stops showing them:

```sql
update you.board_questions
set asks = (select jsonb_agg(case when e->>'answer' is not null and e->>'read_in' is null
              then e || jsonb_build_object('read_in', '<meeting id>') else e end)
            from jsonb_array_elements(asks) e)
where id = '<id>' and user_id = '<user_id>' and asks <> '[]'::jsonb;
```

The question stays `discussing` with its verdict until the person decides on
the tab; never set `decided`, `decided_option` or `decided_at`.

**Watch the spread.** Blind forecasts that agree every time mean the
advisors are one voice. After writing the verdicts, read the widest spread
of the last three meetings that worked a one-way door, this one included:

```sql
select m.id, m.held_on, max((q.verdict ->> 'spread_max')::numeric) as widest
from you.board_meetings m
join you.board_questions q on q.meeting_id = m.id and q.user_id = m.user_id
where m.user_id = '<user_id>' and (m.status = 'ready' or m.id = '<meeting id>')
  and q.verdict ->> 'method' = 'full'
group by m.id, m.held_on
order by m.held_on desc nulls first limit 3;
```

When three rows come back and each `widest` is below 0.15, write one Dev
note, unless one is already open:

```sql
select id from public.feedback_items
where user_id = '<user_id>' and status = 'open' and body like 'Board spread check:%';

insert into public.feedback_items (user_id, kind, body, page_path)
values ('<user_id>', 'bug',
  $n$Board spread check: the advisors' blind forecasts were within 0.15 of each other on every one-way decision for three meetings running (<the three dates>). Their slices or brains may be too alike; look at .claude/skills/board/SKILL.md step 3 and the brains in you.board_advisors.$n$,
  '/you/board')
returning id;
select core.record_dash_action('<user_id>', 'public.feedback_items:<id>', 'insert',
  'board_spread_note', $s$Dash filed a Dev note: the board's advisors have agreed too closely for three meetings.$s$);
```

**Check the tripwires that fell due.** For each one step 1 found, read the
rows its condition names and set its status: `tripped` when the condition
holds, `cleared` when the date passed and it did not. A tripped wire
reopens the question (step 2, Reopening) for the next meeting, and the
digest says so in one line.

```sql
select core.dash_before('you.board_questions:<id>');
update you.board_questions
set tripwire = tripwire || jsonb_build_object('status', 'tripped', 'checked_at', now(), 'fact', $f$…$f$)
where id = '<id>' and user_id = '<user_id>';
select core.record_dash_action('<user_id>', 'you.board_questions:<id>', 'update',
  'board_tripwire', $s$The tripwire on "<question>" tripped: <the fact>.$s$);
```

**Check back on decisions.** For each check-back step 1 found due, read
what happened since `decided_at` in the person's own rows: applications and
their stages, money in and out, goal steps closed or stalled, todos, and
notes they wrote. Write it onto the question:

- `account`: two to four sentences of what happened, each number from a
  query run in this meeting, with its date. Say what the decision changed
  and what it did not; do not grade it yourself.
- `receipts`: `[ { label, link } ]`, a link to each row the account rests
  on.
- `ask`: one line to the person, naming the trade-off the account shows and
  ending in a question on whether it went well ("Taking the contract slowed
  the search and covered the month. Did it go well?"). Where the question
  has a `success_measure`, end instead on whether it was met ("… Did you
  get two first interviews by December?"). They answer on the Board tab
  with Went well, Mixed or Went badly, shown as Met it, Partly and Did not
  where there is a measure. On a decision the advisors forecast, the app
  Brier-scores each advisor's latest probability for the chosen option
  from that answer and works out their `believability` again; on an older
  one it grades each pick. Leave `outcome`, `grades` and `scores` null.

A check-back is due on its day whether or not a meeting has written it: a
daily job notifies the person and the tab asks them from the success
measure. One they answered first already has its entry, so step 1's query
does not find it and it needs no account. Likewise a tripwire they marked
on the tab is no longer `watching`: one they said happened has already put
the question back to `queued` with `fact` "You said it happened.", so take
it up as a reopened question and say in `chair_note` that their answer
reopened it.

```sql
select core.dash_before('you.board_questions:<id>');
update you.board_questions
set reviews = reviews || jsonb_build_array(jsonb_build_object(
      'at', 30, 'option', decided_option, 'meeting_id', '<meeting id>', 'written_at', now(),
      'account', $a$…$a$, 'receipts', $r$[{"label": "…", "link": "/jobs/roles"}]$r$::jsonb,
      'ask', $k$…$k$, 'outcome', null, 'answered_at', null, 'grades', '[]'::jsonb)),
    topic = coalesce(topic, '<topic>')
where id = '<id>' and user_id = '<user_id>' and status = 'decided'
  and not exists (select 1 from jsonb_array_elements(reviews) r where (r->>'at')::int = 30);
select core.record_dash_action('<user_id>', 'you.board_questions:<id>', 'update',
  'board_review', $s$The board checked back on "<question>" after 30 days.$s$);
```

A decision being reviewed is not taken up again unless the person's answer
to an earlier check-back said it went badly and they asked for it.

**Keep the dream on the table.** Every meeting has a `dream`: the dream the
debate came closest to dropping, in the person's own words with its date,
and the smallest thread this week that keeps it going, from the dreamer's
turns or, with no debate, from `week.md`.

**Grade last meeting's predictions** against this week's pack: `hit`,
`miss` or `can't tell`, one line each with the fact that settles it. Add
them to the scorecard carried from the last minutes (hits and misses per
seat, since the first meeting). From the fourth meeting on, say in one line
whose read has been most often right.

**Collect this meeting's predictions.** Ask each of the five seats, in the
same subagent where it sat (a fresh one with `week.md` where it did not),
for one prediction for the coming week that next week's facts can check,
tied to a question it forecast on where it can be. Guests do not predict;
the scorecard is the seats'.

**Filter hard.** A number goes in a verdict or the minutes only if it came
from a query run in this meeting. Cut any condition the person could not
check.

## 11. Suggest new questions

Every meeting leaves three to five new questions for the person to accept or
dismiss, drawn from the week's pack, their goals and their notes. Spread
them across work, money, learning, projects, where and how they live, and
time; no two from the same area unless the pack gives nothing for the
others. **For a panel meeting**, every one is within the panel's topic
instead, and the spread is over the angles the topic has; put the panel's
advisor keys that fit in `advisors`, only keys from `panel_advisors`. Each
is a decision they face now or soon, with two to four lettered options, a
`context` of one to three sentences saying what in the pack raised it (with
dates), the advisors who should hear it in `advisors` where one fits
plainly, and a `door`. Never suggest a question about relationships, health
or family; never repeat one already `suggested`, `queued`, `deferred` or
`dismissed`.

```sql
insert into you.board_questions (user_id, question, options, context, advisors, door, source, status)
values ('<user_id>', $q$Should you take the contract role at Acme while you keep searching?$q$,
        $o$[{"letter":"A","text":"Take it"},{"letter":"B","text":"Turn it down"}]$o$::jsonb,
        $c$The recruiter wrote on 21 October with a three-month contract; your runway note says four months.$c$,
        '{cfo,hiring_manager}', 'one_way', 'board', 'suggested')
returning id;
```

A suggestion is the board's own proposal, waiting on the person, so it is
not recorded as a change to their rows. `meeting_id` stays null until a
meeting debates it; the minutes list the ids under `suggested`.

## 12. Write the minutes

The minutes are one jsonb object in the meeting row. The debate lives in
the turns and the verdicts; the minutes hold what spans the meeting:

```
agenda         [ question id ], in the order debated
suggested      [ question id ], the questions step 11 wrote
digest         [ text ], three to six lines, the weekly meeting's whole
               report: what the person's decisions since changed, each
               check-back and tripwire that fell due and what it found,
               what waits on them (asks, verdicts not yet decided), and
               each question worked with its recommendation, probability
               and spread. Every meeting writes it.
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
                 until it reads the forecasts
chair_note     text?: who sat and why, on which model, guests left out and
               why, options reworded or added, questions skipped; for a
               panel meeting also the panel members who could not sit and
               why, and the questions left for another meeting as off the
               topic
```

`seat` is `hiring_manager`, `mentor`, `skeptic`, `cfo` or `dreamer`, always
spelled that way. In `disagreements`, `point` is the question, and each
seat that sat has one position: `stance` its final forecast in a few words
("Backs B, 0.62"), `text` the reason from its latest turn. Keys run `d1`,
`d2`, `d3` in agenda order. Do not write `question`, `resolutions` or
`memos`.

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

**Read it back.** The meeting is `ready`. For each agenda question:

- it has a `door`, a `success_measure` and a `decide_by`, and a proposed
  measure or date is in `verdict.assumptions` with a matching ask;
- `you.board_turns` holds a round 1 opening with `blind` true from every
  advisor who sat on it, each with a probability, a range and budget points
  for every option, budgets summing to 100, a `change_mind`, an
  `assessment` and a `model`, and the skeptic's and the dreamer's `model`
  differ from the others';
- on a one-way door: `option_order` names every advisor who sat, `options`
  has at least one with `added` true, the advisors' blind probabilities are
  not all the same, round 2 holds a lean reply from every advisor when a
  lean was given and either one exchange of two to four turns between one
  pair with `addressed_to` set, or one steelman and its answer;
  `premortem` has one story per advisor and `tripwire` is watching with a
  `check_on`;
- on a two-way door: one or two round 1 turns and nothing in round 2;
- the question is `discussing` with a `verdict` whose `method` matches the
  door, whose `forecasts` name every advisor who sat, and, on `full`, whose
  `spread` and `spread_max` are set.

Three to five questions are `suggested` with this meeting's ids in
`minutes.suggested`. `minutes` has a `digest`, five `predictions` and five
`scorecard` rows. Every check-back and tripwire step 1 found due is written.

```sql
select question_id, round, kind, count(*) as turns, count(addressed_to) as addressed,
       count(*) filter (where blind) as blind, count(distinct model) as models
from you.board_turns
where meeting_id = '<meeting id>' and user_id = '<user_id>'
group by question_id, round, kind order by question_id, round;
```

If a write fails on a constraint, fix it and send it again once; if it
still fails, mark the row failed as in **The brief** and say why.

End with a short report for the notification: that the board met, each
question with the option it recommends, its weighted probability, the
spread and how many advisors dissented, the number of new suggestions, and
the meeting's date.

---
name: board
description: Hold the person's weekly board meeting. Five advisors (the hiring manager, the mentor, the skeptic, the CFO and the dreamer) each read the same pack of what the person did this week, write a memo alone, then rebut each other; the chair grades last week's predictions, reads the person's votes and answers from last week's minutes, and writes this week's minutes as a vault note through the Dash connector, with the disagreements, one question, at most three proposed resolutions, the dream on the table and each seat's prediction. Use when the weekly board task fires with "Follow .claude/skills/board/SKILL.md", or the user says "convene the board", "call a board meeting about <decision>", or "what does the board think".
---

# The board

Once a week, five advisors read what the person actually did and argue about
it in front of them. One summary would blend everything into advice that
sounds reasonable. Five seats with different jobs pull in different
directions, and the places they pull against each other are usually the
decisions the person is putting off. The minutes lead with those.

**You write one note and nothing else.** No rows, no code, no commits, no
email, no posts, nothing deleted. The board proposes; the person decides.
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

The minutes are written with the Dash connector's `write_vault_note`, loaded
through ToolSearch. If node_modules is empty, run `npm ci` first.

## Checklist

1. **Read the last minutes** and the person's votes and answers.
2. **Build the week's pack**: one file every advisor reads.
3. **Five memos**, one subagent per seat, sent in one message.
4. **Cross-examination**: each seat rebuts one point of another's.
5. **Chair**: grade the predictions, find the disagreements, filter hard.
6. **Write the minutes** as a vault note and read it back.

## 1. Read the last minutes

```sql
select id, path, title, first_written_at, created_at, body
from obsidian.notes
where user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685' and deleted_at is null
  and title ilike 'Board meeting%'
order by created_at desc limit 4;
```

From the newest, take:

- **Votes.** Under each disagreement is a line `Your vote:`. Whatever the
  person wrote after it says which seat they sided with, or why neither.
  A vote means the person already knows that point; do not raise it again
  unless something new changes it.
- **The answer** under `Your answer:` to last week's question. It opens
  this meeting: the chair says what changes because of it.
- **Resolutions.** Each one the person ticked (`- [x]`) or left open. A
  resolution left open three meetings running goes on the agenda as its own
  disagreement: why does it keep not happening?
- **Predictions** and **the scorecard**, graded in step 5.

The first meeting has none of this. Say so in one line of the minutes and
start the scorecard at zero.

If the brief names a decision ("call a board meeting about <decision>"),
this is a called meeting. Read the minutes the same way, then build the
pack around that decision in step 2, and in step 6 replace the
disagreements with each seat's vote on the decision and what would change
it.

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

Write the note with `write_vault_note`, title `Board meeting <d Mon yyyy>`
(`Board meeting 1 Nov 2026`). It lands in the vault's Inbox, where the
person can file it. The body, in this order:

```markdown
## Since last week
<What the person's answer and votes change, in two or three lines; or that this is the first meeting.>

## Where the board disagrees
### <the point, as a plain sentence>
- **<Seat>:** <position, with evidence and links>
- **<Seat>:** <position, with evidence and links>

Your vote:

<one to three of these>

## The dream on the table
<The dreamer's dream, in the person's own words with the note and its date, and the smallest thread that keeps it alive this week. This section is in every meeting, whatever the others think of it.>

## One question
<The question.>

Your answer:

## Resolutions
- [ ] <what>, by <day> (<seat>)

## Predictions for next week
- **<Seat>:** <prediction>

## Last week's predictions
- **<Seat>:** <prediction>: hit | miss | can't tell, <the fact>

## Scorecard
| Seat | Hits | Misses |
|---|---|---|

## The memos
<Each seat's memo and rebuttal, under its name, for the person to read in full if they want to.>
```

Link evidence where it opens in the app: a note at
`/vault/n/<path, each segment URL-encoded>`, a role at `/jobs/roles/<id>`,
a goal at `/goals/<id>`.

Read it back with `vault_notes` or the select in step 1: the note exists
and its body has every section. If `write_vault_note` fails, do not retry
it more than once; put the minutes in your final reply instead and say the
note was not written.

End with a short report for the notification: that the board met, the
headline disagreement in one line, the question, and the note's title.

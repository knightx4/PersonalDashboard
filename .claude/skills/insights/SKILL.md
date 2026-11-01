---
name: insights
description: Write three to five deep insights about the person into you.insights for the Insights tab of You. Read every earlier insight and the person's verdicts first, their Goals areas with how many cards each already has, and their answers on the Ask tab, read the private notes in the journal folders, the journal and daily notes in full, send four subagents to read what they did area by area (career, goals and Learn; money, app use and timing; home, places, the city and music; their chats with Claude), then take each candidate three layers down (what the evidence shows, the mechanism under it, what it protects them from or costs them this week), drop any card that restates one note or rests on numbers not checked in this run, keep the cards to at least three areas with at most two in one, and save each with its area, layers, linked evidence and a confidence. Use when the goals routine is fired with a brief that starts "Follow .claude/skills/insights/SKILL.md" and names "Insight run <id>" (the monthly run or the Look again button), or the user says "write insights about me" or "look again".
---

# Writing deep insights about the person

The Insights tab of You shows a few cards at a time, each telling the person
something about themselves that none of their notes says on its own. A card
makes one claim in their terms, shows the evidence with links, and then goes
two layers further: the mechanism underneath the pattern, and what the
pattern protects them from or costs them, tied to something live this week.
They mark each card right, not quite, wrong or knew it, and the next run
reads those marks. Dash also makes predictions from its cards, which stay
hidden until a later run has checked them against the records.

**Every run spreads across their life.** The person keeps their life in
areas on Goals (`goals.areas`: Career, Money, Home, People and the rest),
and each card names the one it is about (`you.insights.area_id`). The job
search holds the most rows, so a run left to follow the evidence writes
every card about Career. A run's cards cover at least three areas, no more
than two are about any one, and the area that already has the most cards
gets at most one (step 6). People, family, health, sleep and mood are in:
the person asked for them (plan #2629.3).

The method here is the one that produced the first eleven insights by hand
on 18 October 2026, which the person rated well: the Galway theory of their
city politics, finishing only when someone else owns the last mile, fake as
a kind of corruption, Socrates Mode, waiting to be worthy. Those cards worked
because the session read notes in full rather than in excerpts, tested what
the person says about themselves against what the records show, and kept
going past the layer that seemed deep enough.

**You change rows, not code.** Do not commit or push. Do not send email,
post, or contact anyone. Do not delete anything.

In anything the person reads, the assistant is **Dash**. Never write
"Claude" in a card or a summary. Write to `docs/WRITING-GUIDE.md`: plain
sentences, no slogans, no "not X, it's Y", no em dashes for rhythm.

## Checklist

Work these in order. Each has its section below.

1. **Read what came before**: the brief, the run row, where they are now, every answer they wrote to a card's question and on the Ask tab, every earlier insight with its verdict (knew it included), every Goals area with how many cards it already has (tagging earlier cards that have none), check every prediction that is due, and list what the person already knows about themselves.
2. **Read the core in full**: the private notes in the journal folders (`journal_folders` on their `obsidian.vault_connections` row), the dated journal entries, the daily notes, the notes those link to, the Inbox, and the vault map as leads. Skip clipped and secret notes.
3. **Read what they did**: four subagents at once, grouped by area (career, goals and Learn; money, app use and timing; home, places, the city and music; their chats with Claude), each given the Ask tab answers, owner-scoped selects only, each returning 10 to 20 findings with counts, dates, short quotes and the area each is about.
4. **Find candidates** where the strongest ones came from: a concept they named, a claim the records can test, a phrase that comes back, two positions that pull against each other, a want that recurs without action, one structure across unrelated interests, what precedes a low or a binge, and what is missing.
5. **Go down three layers, then one more**: saw, deeper, further, each adding a source or an explanation the layer above lacked, and an outside search for the deeper layer, never their own self-description.
6. **Filter hard**: drop a card that restates one note, has fewer than two sources and no span of time, rests on numbers not re-queried in this run, has a likelier other explanation, or fails the surprise check against what they already know. Label hunches, correct earlier cards, read relationships, health and family as evidence like any other, then spread the cards: at least three areas, at most two in one area, at most one in the area with the most earlier cards.
7. **Write three to five cards** with their area, layers, linked receipts, a confidence, the live thing each points at and a question for them to answer, plus one or two hidden predictions, then finish the run row with a two-sentence summary, a line for each card that touches health and a line naming any area left out.

## How you read and write

Through `npx tsx scripts/sql.ts` (CLAUDE.md, "Rows are written through
scripts/sql.ts"), not the Supabase connector, whose confirmations never
reach a routine. Filter every read and every write by the `user_id` in your
brief. You are writing as the service role, so row level security does not
stop you touching another account's rows; the filter is the only thing that
does. For a long statement, write it to a file in your scratchpad and send
it with `--file`, so quotes and apostrophes need no shell escaping.

Check a column against `information_schema.columns` before relying on it; a
query that fails on a column name is fixed and sent again, not abandoned.

## 1. Read what came before

The brief comes through the goals routine, Dash's general routine
(`insightsBrief` in `lib/you/insights.ts`). The daily cron fires it once the
last finished run is thirty days old, and the Look again button on the
Insights tab fires it whenever the person presses it. It is:

```
Follow .claude/skills/insights/SKILL.md
Insight run <run id>
user_id <uuid>
monthly run | started by Look again | started by a change: <what changed>
```

This session is the whole run. Nothing else writes cards, so take the time
the reading needs.

```sql
select id, status, requested_at from you.insight_runs
where id = '<run id>' and user_id = '<user_id>';
```

If the row is missing, or its status is `ready` or `failed`, stop: it has
been handled. Otherwise mark it started:

```sql
update you.insight_runs set status = 'running', started_at = now(), error = null
where id = '<run id>' and user_id = '<user_id>';
```

**Where they are now comes first.** `you.now` is one row in their words:
money, what they are focused on, what they have decided against. It is the
newest thing they have said about their life and it outranks any older note
on the same subject. Read it before anything else, and carry it through the
run: a card that reads a choice it describes as a gap or a failure is
wrong before it is written.

```sql
select body, updated_at from you.now where user_id = '<user_id>';
```

If it is empty or more than a month old, say so in the summary, and lean on
their answers and verdict notes for the present instead.

**Their answers are the best material the run has.** Every card ends with a
question, and what they wrote back is them thinking about themselves out
loud, prompted by the place Dash got closest. Read every answer in full
before the notes. Each answer is a lead: what they said that a card had not
seen, what they pushed back on, and above all what they said in passing
while answering something else. At least one card in every run starts from
an answer when there are any, and goes past it with the notes and records.

```sql
select id, claim, question, answer, answered_at from you.insights
where user_id = '<user_id>' and answer is not null
order by answered_at desc;
```

Then their answers on the Ask tab of You, where Dash asks them about
themselves without a card in front of it (`.claude/skills/dash-questions/`).
These answers are often about the parts of their life the records hold
least of, such as home, people and music, so they are the best lead into an
area with few rows. Read every one in full, and hand them to every reader in
step 3.

```sql
select q.id, q.question, q.why, q.answer, q.answered_at, a.name as area
from you.dash_questions q
left join goals.areas a on a.id = q.area_id and a.user_id = q.user_id
where q.user_id = '<user_id>' and q.status = 'answered'
order by q.answered_at desc;
```

Then read every insight written before, in every status, with its verdict.
This is the list the run must not repeat.

```sql
select i.id, i.kind, i.claim, i.layers, i.receipts, i.confidence, i.status,
       i.created_at, i.question, i.answer, v.verdict, v.note, v.decided_at
from you.insights i
left join you.insight_verdicts v on v.insight_id = i.id and v.user_id = i.user_id
where i.user_id = '<user_id>'
order by i.created_at desc;
```

- **Marked right or wrong**: never write it again, nor a card whose claim a
  reader would take for the same one in other words. A right card is
  settled; a wrong one was wrong.
- **Marked not quite**: rework it with the person's note in hand. The new
  card answers the note, and when it is saved the old one is superseded by
  it (step 7).
- **Marked knew it**: true, and they already knew it. Never write it again,
  and treat it as a miss: the card told them nothing. Note what made it
  obvious (usually a deeper layer taken from their own notes) and make
  sure no card in this run is obvious in the same way.
- **Not marked**: do not repeat it either; it is still on their tab.
- **What the verdicts say about the method**: read the notes on not quite
  and wrong for what they object to, such as a claim that was too neat or
  evidence that was a misreading, and avoid it in every card of this run.
  A verdict note is also the person telling you about their life: money,
  plans, what they have moved on from. Treat what it says as fact for this
  run, the same as `you.now`.

**What has landed and what has not.** Up to 25 October 2026 the cards
marked right described how they think: one rule under their economics,
their city and Dash; projects stalling once only plumbing is left. The
cards that missed checked what they did against what they said they would
(applications against their own rules, a side interest read as a career
gap) and were true but no use, or missed the reason behind the choice.
Aim at the first kind (step 4).

**Their areas, and how many cards each already has.** Read every open area
with its note (what the person wrote the area is for):

```sql
select a.id, a.name, a.note,
       count(i.id) filter (where i.kind <> 'prediction' and i.status <> 'superseded') as earlier_cards
from goals.areas a
left join you.insights i on i.area_id = a.id and i.user_id = a.user_id
where a.user_id = '<user_id>' and a.archived_at is null
group by a.id, a.name, a.note, a.position
order by a.position;
```

An earlier card with no area was written before cards carried one, or is
about health, sleep or mood (step 6), which has no area. Before counting,
give each untagged card the area its claim is about, so the counts the
spread rule uses (step 6) are true. Family and friends are People. A card
about health, sleep or mood stays with none, and so does one that fits no
open area; say which in the summary.

```sql
update you.insights set area_id = '<area id>'
where id = '<insight id>' and user_id = '<user_id>' and area_id is null;
```

Then run the count again and keep it: the area with the most earlier cards
is the one the spread limits to one card in this run.

**Check the predictions that are due.** A prediction (step 7) is saved with
status `pending`, which the tab never shows, and `check_on`, the first day
the records can tell whether it came true. Check each one due now before
anything else:

```sql
select id, claim, layers, receipts, check_on, created_at from you.insights
where user_id = '<user_id>' and status = 'pending' and check_on <= current_date
order by check_on;
```

For each, run the query its layers or receipts name (or the nearest one the
tables allow) over the window it gave, and decide: `happened`, `did_not`,
or `unclear` when the records cannot say. Be strict: a prediction that came
partly true did not happen. Then show it with the result:

```sql
update you.insights
set outcome = 'happened', outcome_note = $n$What the records showed, with the dates and numbers.$n$,
    checked_at = now(), status = 'shown',
    receipts = receipts || $j$[{"source": "...", "row_id": null, "quote": "...", "link": "..."}]$j$::jsonb
where id = '<id>' and user_id = '<user_id>' and status = 'pending';
```

A prediction that did not happen is as useful to show as one that did: it
tells the person, and the next run, which of Dash's readings of them was
wrong. Read the outcomes of every checked prediction, earlier ones too, as
evidence about the method. A reading whose predictions keep failing is a
misreading, and a card built on it is dropped.

Then make a list of what the person already knows about themselves, so no
card tells them something they wrote down. Read in full their own
self-descriptions: every note in the journal folders whose title says it is
about who they are (an about-me note, an autobiography, notes to self, a list
of mottos, personal goals, favourite things, an index of interests), wherever
the person keeps them. List the paths found this run in the summary, so the
next run starts from them. Their personality results
(`you.personality_results`: `kind`, `test_name`, the five scores,
`typed_value`, `note`, `taken_at`, `type_scores`, `themes`) go on the list
too, and so does Dash's newest analysis across them
(`you.personality_profiles`, the newest row by `created_at`: `summary`,
`agreements`, `tensions` with their verdicts, and `watch` with the number
behind each). The person has read that analysis on the Personality tab, so a
card that only repeats it tells them nothing; its tensions and `watch`
patterns are good places to start digging, and a card that finds the record
disagreeing with one says so. A card may start from something on this list;
it may not stop there.

## 2. Read the core in full

Read whole bodies, not snippets or search hits. The depth of the first
insights came from reading a note to its end and finding the line that
contradicted its opening.

**Which notes to leave out.** Step #2413.3 adds `obsidian.notes.voice`, one
of `private`, `audience`, `clipped`, `reference` or `secret`, with
`voice_reason`. Check whether it is there:

```sql
select column_name from information_schema.columns
where table_schema = 'obsidian' and table_name = 'notes' and column_name in ('voice', 'voice_reason');
```

- With `voice`: never read a note whose voice is `secret`, and skip
  `clipped`. Read `reference` notes only to see what interested them, never
  as what they think. Treat `audience` notes (applications, essays, posts)
  as what they wrote to persuade someone: a position that appears only in
  `audience` notes is a claim to test, not a belief.
- Without it: never read any note tagged `secret`, or one whose title, path
  or opening holds logins, passwords or keys; skip notes tagged
  `clipped`, and treat `Bulk/Bulk - Wiki`, `Resources/` and course summaries
  as clipped. Treat `Career/` applications and admissions essays as written
  for an audience.

Either way, never quote a secret note, and say in the run's summary when the
voice tags were not there yet.

```sql
-- the notes a run may read, with the voice filter when the column exists
select id, path, title, first_written_at, first_written_source, git_updated_at,
       char_length(body) as chars
from obsidian.notes
where user_id = '<user_id>' and deleted_at is null
  and path !~* 'password'
  and coalesce(frontmatter ->> 'tags', '') !~* '\m(secret|clipped)\M'
  -- and voice is distinct from 'secret' and voice is distinct from 'clipped'
order by path;
```

Read, in full:

1. **Every private note in the journal folders**, including the trip notes and the people
   notes, which hold the most unguarded writing in the vault. Read the
   people notes for what they say about the person and how they are with
   the people in their life, and the entries about family, health, sleep
   and mood as evidence like any other (step 6). A card is about the person,
   never a verdict on someone else.
2. **The dated journal entries.** A note with `dated_entries` holds several
   entries, each `{date, offset, end}` with offsets in Unicode characters
   (`readDatedEntries` in `lib/vault/notes/first-written.ts`). Postgres
   counts characters the same way:

   ```sql
   select n.path, e ->> 'date' as entry_date,
          substring(n.body from (e ->> 'offset')::int + 1
                    for (e ->> 'end')::int - (e ->> 'offset')::int) as entry
   from obsidian.notes n, jsonb_array_elements(n.dated_entries) e
   where n.user_id = '<user_id>' and n.deleted_at is null
   order by entry_date;
   ```

3. **The daily notes**, whose file name is a date
   (`path ~ '(^|/)\d{4}-\d{2}-\d{2}\.md$'`).
4. **The notes those link to.** Follow the `[[wiki links]]` out of what you
   read in 1 to 3, one step. In the first session these were short essays
   and travel notes the journal pointed to; read whatever this run's
   reading links to.
5. **The Inbox** (`path like 'Inbox/%'`): what they wrote most recently and
   have not filed.
6. **What a chat saved about them.** Rows of `you.claude_chats` with
   `origin = 'saved'` are moments from their chats with Claude that the
   chat judged said something about them, in their words, with why. Read
   every one. They are as unguarded as the journal and newer than most of
   it.

   ```sql
   select said_at, body, why from you.claude_chats
   where user_id = '<user_id>' and origin = 'saved' order by said_at desc;
   ```

Date a note by `first_written_at`, never `created_at`, which is when the
sync first saw it. Where `first_written_at` is null, say the date is unknown
rather than guessing.

**The vault map, as leads.** The map holds the positions, themes and
tensions a sweep pulled from the notes. Take the most central and strongest
as places to look, then go to the notes they came from; a position on the
map is a summary someone else wrote, so it is never the evidence.

```sql
select p.id, p.name, p.statement, p.kind, p.stance, p.centrality,
       count(ps.id) as sources
from obsidian.positions p
left join obsidian.position_sources ps on ps.position_id = p.id and ps.user_id = p.user_id
where p.user_id = '<user_id>' and p.ungrounded_at is null
group by p.id order by p.centrality desc nulls last limit 25;

select id, name, about, strength, first_seen, last_seen from obsidian.themes
where user_id = '<user_id>' order by strength desc nulls last limit 15;

select t.id, t.kind, t.status, t.crux, l.name as left_position, r.name as right_position
from obsidian.tensions t
join obsidian.positions l on l.id = t.left_id
join obsidian.positions r on r.id = t.right_id
where t.user_id = '<user_id>' and t.resolved_at is null;
```

With the voice tags in, `position_sources` joined to `obsidian.notes` says
whether a position's notes were private or written for an audience: a
position held only in audience notes is a lead for a testable claim.

## 3. Read what they did

Send four subagents in one message, so they run at the same time. They
are grouped by area so that no one part of the person's life fills the
reading: the job search holds the most rows, and here it is a third of one
reader's brief. Each gets the `user_id`, the rule that it runs owner-scoped
selects through `npx tsx scripts/sql.ts` and nothing else (no inserts, no
updates, no connector), the list of open areas from step 1, every answer
from the Ask tab (step 1), the tables below as a starting point, and this
request:

> Return 10 to 20 findings. Each names what you counted, the number, the
> dates it spans, the table and row ids it came from, a short quote where
> one exists, and the area it is about (one of the areas given, or
> "health" for health, sleep and mood, or "none"). Label anything you infer
> rather than count as a hunch. Check a column against information_schema
> before relying on it. Read what concerns people, family, health, sleep
> and mood as evidence like any other, and spread your findings across
> every area your tables reach rather than stopping at the one with the
> most rows. Use the Ask tab answers as leads: what they said there that
> your tables can test.

**(a) Career, goals and Learn.** Three equal parts. The job search:
say-versus-do gaps between what `job_search.thoughts` and their goals say
they want and the roles they applied to (`job_search.applications` joined
to `job_search.roles`: `status`, `outcome`, `rejection_stage`,
`excitement`, `submitted_at`, `closed_at`), and effort by role (drafts,
answers, cover letters per application). Goals in every area: `goals.items`
by `area_id` (which areas have open goals, which have none, which have
moved), steps that slipped their `due_on`, `todo.tasks` opened and never
closed, what got finished and whether someone else was waiting on it.
Learn: `learn.aims`, `learn.readings` started against finished,
`learn.essays` drafted against published.

**(b) Money, app use and timing.** `public.orders` and
`public.recurring_payments` by month and merchant; `core.page_view_days`
by workspace and day (what they open, what they never open);
`core.conversations` and `core.conversation_turns` (role `user`) for what
they ask Dash and when; `you.personality_results`; `you.courses` grades by
school and term. Then timing: give this reader the dates you found in step
2 of each low (journal and daily notes that say so), and ask what happened
in the days before each: orders, app use, messages to Dash, applications,
rejections (`job_search.applications` with `outcome = 'rejected'`, by
`closed_at`). Then the same for each burst of building, taken from
`git log --since=<date> --format=%ad --date=short | sort | uniq -c` in this
repository and `public.plan_items` by `updated_at`, and for each rejection:
what came in the week after. What the notes say of sleep and mood in those
days counts.

**(c) Home, places, the city and music.** `you.places` and
`you.work_history` for where they lived and worked when, and how long each
lasted; `public.orders` joined to `public.order_items` and
`public.categories` by category (home, kitchen, clothing, gear, tickets),
against the months they moved; `goals.items` in the Home, city, Music and
People areas (whatever the areas from step 1 are called); and the vault
notes by theme (`obsidian.themes` and the notes behind them) on home, the
city, music and the people in their life. What they say they want from a
place or a scene, against where their time and money go.

**(d) Their chats with Claude.** `you.claude_chats` with
`origin = 'export'` holds every message they wrote on claude.ai (never
Claude's replies), with `conversation_title` and `said_at`; there may be
thousands. Most ask for help with code or writing. Ask this reader to find
the minority where they think out loud about themselves: why they want or
dropped something, how they decided, what they were worried about, how they
describe their own work, what they argued with Claude about, and what they
asked for help with at odd hours or more than once. Ask for the quotes with
their dates and titles, how often a subject or worry comes back across
months, and what they said in a chat that their notes never say. Have it
page through by `said_at` in batches of a few hundred rather than search
for words, since what matters is often phrased in ways no search would
guess. A chat is where they are thinking before they have decided, so what
they say there can differ from the note they wrote after; that difference
is a lead. Ask it to name each finding's area as well, since chats about
code would otherwise all read as Career.

If `you.claude_chats` holds no export rows, skip this reader and say in the
run's summary that the chats have not been imported.

If the session has no tool for subagents, do the four passes yourself in
turn, with the same request.

## 4. Find candidates

Lay the reading from steps 2 and 3 side by side and look for these. They are
where every strong card in the first session came from, and each maps to the
card's `kind` (`INSIGHT_KINDS` in `lib/you/insights.ts`):

| Look for | kind |
|---|---|
| A concept they named themselves (Socrates Mode, worthy, rest in reason, Galway me) | `named_concept` |
| A claim they make about themselves that the records can test | `testable_claim` |
| A phrase that comes back across years | `recurring_phrase` |
| Two held positions that pull against each other | `tension` |
| A want that recurs without action | `unmet_want` |
| The same structure across unrelated interests | `shared_structure` |
| What reliably precedes a low or a binge | `precursor` |
| Something that is missing: a want that dropped out of the notes, a page or workspace never opened, a person or subject never written about, a step never taken | `absence` |

A prediction (step 7) is `prediction`. A card that fits none of these is `pattern`. Write down ten or more
candidates before choosing; most will not survive steps 5 and 6. Note each
candidate's area as you write it down, and have candidates in at least four
areas, so the spread in step 6 has something to choose from. Where an area
has none, look again in that area's notes, goals and Ask tab answers before
giving up on it.

**Aim at how they work, not at whether they kept to their word.** The cards
that land describe the machinery: how they decide, what gives them energy
and what drains it, the rule they apply without saying it, what they reach
for under pressure, what they protect. A gap between what they said and
what they did is a lead into that machinery, never the card itself. "You
said X and did Y" is at most the saw layer; the card is the reason, and the
reason has to be one they had not put into words. At most one card in a
run may be mainly about such a gap.

**Every card has to be usable.** The further layer ends in something they
can do, test or decide differently this week, or a choice in front of them
that the card reframes. "Close, but nothing tangible" is a miss even when
the reading is right.

**Look for absences on purpose.** People see what they did and miss what
they did not, so a zero is where a surprise most often is. At least two
candidates in every run start from one: a subject that filled the notes in
one year and is gone from them now, a workspace or page with no views in
`core.page_view_days`, a stated want with no order, application, reading
or step anywhere, a kind of task always left for last. An absence needs a
span of time like any other card: show when the thing was there, or should
have been, and that it has not been since.

## 5. Go down three layers, then one more than seems needed

Every card has three layers, saved in this order:

- **saw**: the evidence, with quotes and numbers. What the notes and the
  records show, side by side.
- **deeper**: the mechanism underneath. It must add a source or an
  explanation the first layer did not have. A rephrasing of the first layer
  is not a second layer.
- **further**: what the pattern protects them from or costs them, tied to
  something live this week where one exists: an open deadline, a goal step,
  a job lead, an essay in draft.

**The deeper layer may not rest on their self-descriptions.** The list from
step 1 (the about-me note, notes to self, mottos, personality results) can be where
a card starts or a receipt in the saw layer. It cannot be the mechanism.
"You don't like waiting, so you build when waiting" hands their own line back
to them, and they knew it already. The 19 October cards did this, and that is
why they read as shallow.

**Search outside for every deeper layer.** For each candidate that survives
to this step, run at least one web search for what explains the pattern:
research on the behaviour, a framework from psychology, economics or design,
a historical figure or a place with the same structure. Read what you find,
and use it only if it explains their case better than their notes do. Cite
it as a receipt with its https link. A card whose deeper layer still has no
outside source is a `hunch` at most.

Before writing a card, ask what would make the deeper layer obvious to the
person, and go past that. The further layers that worked:

- the Galway study, found while researching sprawl, that explained their
  city politics better than their own notes did;
- building Dash passes every one of their own authenticity checks, which is
  why the avoidance it allows is invisible to them;
- the one format that judges them on depth with no clock is the one they
  have left untouched.

Each of those came from one more search after the card already looked
finished.

## 6. Filter hard

Drop:

- any card that restates one note, however well;
- any card without two sources or a span of time;
- any card whose numbers were not re-queried in this run. A number a
  subagent gave you is re-run by you before it goes on a card; a number
  from an earlier insight is re-run too;
- any card that fails the surprise check.

**Other explanations.** For every card, write down the two likeliest other
reasons for what the saw layer shows: money, time, a deliberate choice, a
change in circumstance, something they said in `you.now`, an answer or a
verdict note. Check each against the records. Drop the card if one of them
explains the evidence as well as the card does; say in the deeper layer
which ones you ruled out and how, in a sentence. A card that skipped this
step is the kind that came back "factually true but not that helpful".

**The surprise check.** Send one subagent the list from step 1 (their
self-descriptions and personality results, in full) and the claims and
deeper layers of every candidate still standing, and nothing else: none of
your evidence. Ask it, for each card, whether someone who had read only
those notes would already have said it, and to answer `obvious`,
`partly` or `new` with one sentence of why. Drop every `obvious` card. A
`partly` card stays only if its further layer is what the notes miss, and
you rewrite it to lead with that. If fewer than three cards are `new`,
go back to step 4 for more candidates before you write anything.

Then:

- **Label hunches.** A card whose deeper layer is your inference, not
  something a source shows, has `confidence = 'hunch'`. `high` is for a
  card whose every layer has a receipt; `medium` for the rest.
- **Correct earlier cards that were wrong.** If this run's reading shows an
  earlier card misread the evidence (the first session took concert tickets
  for a live electronic set they performed), write the corrected card and
  supersede the old one.
- **Read relationships, health and family as evidence like any other.**
  The person asked for every part of their life (plan #2629.3). A card
  about how they are with family or friends is a People card. A card about
  health, sleep or mood has no area. A card is still about the person: what
  they do and why, never a judgement of someone in their life.
- **Never read or quote a note tagged secret.**

**Spread the cards across their areas.** Give every card still standing
its area from step 1, or none for health, sleep and mood. Then keep three to
five so that:

- the cards cover **at least three areas**. Health, sleep and mood cards
  count together as one more area, so two of them and a Career card make
  two, not three;
- **no more than two cards are about one area**;
- the area with the most earlier cards (the count from step 1) gets **at
  most one**. When two areas tie for most, the limit holds for both.

Predictions take an area too, and do not count toward the spread.

When the strongest cards break the rule, drop the weakest card in the area
that is over and take the strongest card in an area not yet covered. Never
weaken the filter above to fill an area: an area with too little evidence
for a card that passes it is left out, and the summary names it with what
was missing (step 7). If the cards that pass cover fewer than three areas,
write the ones that do and say so in the summary; never pad.

## 7. Write the cards and finish the run

Write each card in the person's own words where possible, to them as "you".
`claim` is one or two sentences (at most 1,000 characters).

- `kind`: from step 4.
- `area_id`: the id of the area from step 6, from the step 1 list of open
  areas, or null for a card about health, sleep or mood.
- `layers`: `[{"depth": "saw", "text": ...}, {"depth": "deeper", ...}, {"depth": "further", ...}]`.
- `receipts`: every source the card relies on, each
  `{"source", "row_id", "quote", "link"}`. `source` is the table
  (`job_search.applications`) or the vault path (`Journal/Notes to self.md`);
  `row_id` the row's id or null for a note; `quote` the words or the number
  relied on; `link` where it opens in the app: a note at
  `/vault/n/<path, each segment URL-encoded>`, a role at
  `/jobs/roles/<id>`, a goal at `/goals/<id>`, a map theme at
  `/vault/map/<theme id>` (a position opens on its theme's page). A link that is not an app path or an https page is
  dropped when the tab reads it.
- **Links in the text.** In the layers and `live_ref`, link what you cite
  where you cite it, as `[words](link)` with the same link as its receipt:
  "your [journal on 25 January 2025](/vault/n/Journal/Journal.md) says ...".
  Every note, role, goal or page a layer names gets a link the first time it
  is named. Encode `(` and `)` in a link as `%28` and `%29`. The tab also
  links a receipt's exact quote or note title where the text repeats it, but
  write the links anyway; most mentions are paraphrased.
- `confidence`: `high`, `medium` or `hunch`.
- `live_ref`: the deadline, step or lead the further layer points at, in
  one line (at most 300 characters), or null.
- `question`: one question for them to answer on the card, at most 300
  characters. Ask the thing the card could not find out from the records
  and that only they can say: which reason was the real one, what they
  felt at the moment the pattern started, what they would choose if the
  constraint went away. Never a yes-or-no question, never a question the
  card has already answered, never "does this resonate?". Their answer is
  the first thing the next run reads.

**Predictions.** Besides the cards, write one or two predictions: what the
pattern in a card says the person will do next, stated so the records can
show it. Name the event that starts it, what they will do, and a window,
such as "Within five days of the next rejection, you will spend at least
three nights past midnight on the build pages and send no applications."
Choose ones a reader could not make from their own notes, and that the
tables in step 3 can check without asking them. Set `check_on` to the
first day the window has closed, no later than four weeks from now, so the
next monthly run can check it; for a prediction that waits on an event
(the next rejection), set it four weeks out and say in `outcome_note` if the
event never came, with `unclear`. Save it with `kind = 'prediction'`,
`status = 'pending'`, its layers (why Dash expects it), and a receipt naming
the table and the count that will decide it. The person does not see it
until a later run has checked it.

```sql
insert into you.insights (user_id, run_id, area_id, kind, claim, layers, receipts, confidence, status, check_on)
values ('<user_id>', '<run id>', '<area id>', 'prediction', $c$...$c$,
        $j$[ ... ]$j$::jsonb, $j$[ ... ]$j$::jsonb, 'medium', 'pending', '<yyyy-mm-dd>')
returning id;
```

Write each card:

```sql
insert into you.insights (user_id, run_id, area_id, kind, claim, layers, receipts, confidence, live_ref, question)
values ('<user_id>', '<run id>', '<area id>', 'named_concept', $c$...$c$,
        $j$[ ... ]$j$::jsonb, $j$[ ... ]$j$::jsonb, 'medium', $l$...$l$, $q$...$q$)
returning id;
```

For a card about health, sleep or mood, write `null` in place of
`'<area id>'`. The area id has to be one of the person's own areas: the key
on `(area_id, user_id)` refuses another account's.

A card that reworks one marked not quite, or corrects a wrong one,
supersedes it once the new row exists:

```sql
update you.insights set status = 'superseded', superseded_by = '<new id>'
where id = '<old id>' and user_id = '<user_id>';
```

Finish the run row with a two-sentence summary of what the run read and
what it found (say how many predictions it checked and how they came out,
and how many it left pending; never say what a pending one predicts). After
the two sentences, add a line for each of these that applies:

- each card that touches health, sleep or mood, by the start of its claim,
  so the person sees it is there before they open the tab in front of
  someone: "Touches health: You sleep less in the weeks …";
- each open area left without a card in this run, with what was missing:
  "No card on Music: two notes and no orders or goals since 2024.";
- the earlier cards tagged with an area in step 1, as a count, and any left
  with none.

Then record it so Home lists it under what Dash did today:

```sql
select core.dash_before('you.insight_runs:<run id>');
update you.insight_runs
set status = 'ready', finished_at = now(), error = null, summary = $s$...$s$
where id = '<run id>' and user_id = '<user_id>';
select core.record_dash_action('<user_id>', 'you.insight_runs:<run id>',
  'update', 'insights_run', $s$Dash wrote <n> insights about you.$s$);
```

Read it back: the run is `ready`, and `select count(*) from you.insights
where run_id = '<run id>' and user_id = '<user_id>'` is what you wrote,
each with three layers, at least two receipts and, for every card that is
not a prediction, a question. Check the spread from the rows:

```sql
select coalesce(a.name, 'no area') as area, count(*) as cards
from you.insights i
left join goals.areas a on a.id = i.area_id and a.user_id = i.user_id
where i.run_id = '<run id>' and i.user_id = '<user_id>' and i.kind <> 'prediction'
group by 1 order by 2 desc;
```

At least three groups, none above two. If it is wrong, an `area_id` was
missed or mistyped: fix the card with an update scoped to its id and the
`user_id`.

If the run cannot finish (the notes cannot be read, every candidate fails
step 6), mark it failed with a sentence the person can act on, and keep any
card already written:

```sql
update you.insight_runs
set status = 'failed', finished_at = now(),
    error = $e$Dash could not read your vault notes: the last sync failed. Sync the vault and press Look again.$e$
where id = '<run id>' and user_id = '<user_id>';
```

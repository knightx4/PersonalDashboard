# Building an advisor's brain

An advisor sits on the board with a brain: what Dash has gathered about how
that advisor decides. The board skill briefs every advisor with its brain
(SKILL.md, **The advisors**), so the brain is most of what the advisor can
say. A guest's brain comes from that person's public work; a seat's comes
from the research and practice behind its role (**Seats** below). Cite every
part of it, and keep anyone's own words apart from your summary of them.

**Why the brain is shaped like this.** Language models asked to play a
famous person drift towards the stereotype of that person, and a board of
stereotypes agrees with itself: in the 27 October 2026 meeting nearly every
advisor gave the same option an 8 or a 9. Persona research finds that a
role holds when it is specific: rules in the person's own phrasing, stories
with dates, named disagreements, things the persona would refuse to say.
So the brain asks for exactly those, and a brain that could belong to any
wise person fails the check in step 4.

**You write one row and nothing else**: the advisor's row in
`you.board_advisors`, its `brain`, `brain_status` and, when it is a
placeholder, its `question`. No other rows, no code, no commits, nothing
deleted.

## The brief

The Board tab, when the person adds an advisor, fires the board routine
with:

```
Follow .claude/skills/board/advisor-brain.md
Build advisor <advisor id>
user_id <uuid>
```

A session asked to build the seeded guests, the seats, or to rebuild one,
does the same for each row, one at a time, named by its `key`.

## 1. Read the row and the roster, and claim it

Through `npx tsx scripts/sql.ts` (CLAUDE.md, "Rows are written through
scripts/sql.ts"), every statement scoped to the owner's `user_id`:

```sql
select id, key, name, kind, question, focus, brain, brain_status, active
from you.board_advisors
where id = '<advisor id>' and user_id = '<user_id>';
```

Stop if the row is not there. Keep the whole row as it is now; step 6
passes it as the row before. Read the rest of the roster too, since the
brain names advisors it disagrees with:

```sql
select key, name, kind, question, focus
from you.board_advisors
where user_id = '<user_id>' and key <> '<key>'
order by kind desc, key;
```

Then mark it building, so the tab shows the work under way. Skip this for
a rebuild of a brain that is `ready`: the advisor keeps sitting on the old
brain until the new one is written.

```sql
update you.board_advisors set brain_status = 'building'
where id = '<advisor id>' and user_id = '<user_id>';
```

This is Dash's own bookkeeping and is not recorded; step 6 records the
change the person sees.

## 2. Read the sources

For a guest, send subagents, each with one kind of source and the advisor's
`name`, `question` and `focus`:

- **Their own writing**: books, shareholder or annual letters, essays,
  letters, notebooks, speeches as delivered, testimony.
- **Their own voice**: talks, interviews, podcasts, oral histories, with a
  transcript where one exists.
- **What others established**: well-sourced biographies, museum and archive
  pages, editors' notes in a papers edition. For a historical figure, prefer
  a scholarly edition of their papers (Founders Online, a museum's
  catalogue) and public-domain texts (Project Gutenberg, Wikisource) to
  anything recent.

For a seat, the sources are the ones **Seats** names for it.

Ask each subagent for the material that makes a brain specific, not the
famous lines everyone knows: dated episodes, decisions they reversed,
places they argued against the consensus of their field, people they
argued with, and what they said they would never do. Each returns, for
every source it read, a label (title, year, publisher or venue), a link,
and the passages that bear on how the person decides, **copied verbatim
from the page it opened**, each marked with where it sits. A passage it
remembers but did not read on the page comes back as a paraphrase, never as
a quote. Quote collections and "best quotes" pages are not sources: many
lines on them were never said.

Check each link opens: `curl -sL -o /dev/null -w '%{http_code}'`, or a
fetch. A page that refuses the check (a 403 from a bot wall, a JavaScript
challenge) stays only when a search result shows that page under that
title. A dead link is replaced or dropped, never kept.

Aim for twelve or more sources so ten survive the check. A brain needs **at
least ten linked sources**; with fewer, go to step 7.

## 3. Write the brain

`brain` is one jsonb object:

```
version        2
assessment     { name, text }              the one assessment they own
evidence       [ text ]                    two to four: what they ask to see first
questions      [ text ]                    three to five signature questions
rules          [ text ]                    eight, in their own phrasing, each sourced
frameworks     [ { name, text } ]          three to six named ways of thinking
positions      [ { topic, text } ]         four to eight stances on recurring questions
contrarian     [ { common, text } ]        two to four places they reject the usual view
disagreements  [ { advisor, text } ]       two to four, each with another advisor by key
stories        [ { date, text, source } ]  three to five, dated, source a link
never          [ text ]                    three to five things they would never say
voice          text                        how they talk, in three or four sentences
sources        [ { label, link } ]         every source read, ten at least
```

- **The assessment** is the one judgement this advisor makes of every
  option and nobody else on the board makes: Buffett rates whether you
  understand the thing well enough to hold it for twenty years, the CFO
  rates the months of runway an option leaves. `name` is a few words; `text`
  says what is rated, on what evidence, and what a good and a bad answer
  look like. Two advisors on one board never own the same assessment, so
  read the roster's brains first and pick a different one when it overlaps.
  It is what the meeting asks this advisor to judge (SKILL.md), so make it
  answerable from the person's own records.
- **Evidence** is what they would ask to see before giving a view, in the
  order they would ask: "the last three months of bank statements", "the
  job description and the two people you would report to".
- **Questions** are the ones they are known for asking, in their words where
  a source has them, quoted and attributed; otherwise in their manner and
  written as your summary.
- **The question.** The row's `question` is the one question this advisor
  owns. Keep it when the person wrote it. When it is empty or a placeholder
  (the tab writes "What would <name> make of this?" for a guest the person
  adds), write one from the assessment, in their terms and addressed to
  "you", and set it in the same update.
- **Rules** are what they decide by, eight of them, each with its source in
  brackets at the end: `(1996 letter)`. Write them in the person's own
  vocabulary and with their own oddities, as instructions the advisor can
  apply to the person's choice. A rule any sensible person would agree with
  ("think long term", "learn from mistakes") is not one of theirs; find the
  version only they would put that way, or the rule beside it that they hold
  and others do not.
- **Frameworks** are their named ways of thinking (circle of competence,
  the OODA loop, moral algebra), each with what it is and how to use it.
- **Positions** take the topics a board question keeps raising: risk,
  money, mistakes, career moves, time, people, failure, saying no. Write
  the stance they took and where they took it.
- **Contrarian** holds where they part from the conventional wisdom of their
  field or of career advice: `common` states the usual view in a sentence,
  `text` says what they held instead and where, with its source.
- **Disagreements** name other advisors on this board by `key` (from the
  roster read in step 1), at least one of them a seat when the advisor is a
  guest, and say where the two would part on a decision like the person's
  and why, from this brain's sources. This is your reading of two bodies of
  work side by side, so write it as your summary, never as words either of
  them said about the other, unless a source records them saying it.
- **Stories** are things that happened that they told, or that a sound
  source records, with the year or full date in `date` and the link in
  `source`. Prefer the episode with a number, a place and a consequence to
  the famous anecdote.
- **Never** lists what this advisor would not say or advise, with the reason
  from the sources: Buffett would not tell you to borrow to buy, Seneca would
  not tell you a better job will make you content. These keep the advisor
  from agreeing with whoever spoke last.
- **Voice** says how they talk: sentence length, the words they reach for,
  their humour, what they never say.
- **Sources** are every page read, label and link. A source cited anywhere
  in the brain is in this list.

**Quotes are marked and attributed.** Their own words go in double quotes,
followed by where they said them: `"Price is what you pay; value is what you
get." (2008 letter, quoting Ben Graham)`. Only a passage read verbatim on a
page in this run is a quote. Everything else is your summary, written as
one, and never phrased as though they said it. A saying they repeated from
someone else says so. A translated text says which translation. Nothing in
the brain may present invented words as theirs.

Write to `docs/WRITING-GUIDE.md`. The person reads the brain on the Board
tab, so name Dash, never "Claude", where Dash is named at all.

## Seats

The five seats (`hiring_manager`, `mentor`, `skeptic`, `cfo`, `dreamer`)
are invented characters, not real people, so their brains come from what
is known about doing their job well. Their paragraphs in SKILL.md still
set their horizon and what they read; the brain gives them a way of
deciding that is theirs. The same fields and checks apply, with three
differences: quotes are from the researchers and practitioners the seat
draws on, attributed to them; `voice` describes the character, written as
a description of a character; and a story is a finding or case from the
literature with its year, not something the seat lived through.

- **Hiring manager**: research on what predicts job performance and how
  interviewers decide (Schmidt and Hunter's meta-analyses, structured
  interviewing, work samples), recruiter and hiring manager practice on how
  applications are screened (eye-tracking of résumé reads, referral
  conversion), and what employers say they look for in finance and
  strategy hires.
- **Mentor**: developmental network research (Higgins and Kram), career
  capital and career change research (Ibarra's *Working Identity*, studies
  of protean careers), and what long careers in finance and strategy
  actually ran through.
- **Skeptic**: base rates and the outside view (Kahneman and Lovallo),
  the premortem (Klein), the planning fallacy, forecasting research
  (Tetlock), and the intention-behaviour gap (Sheeran).
- **CFO**: personal finance and runway practice: emergency funds and
  liquidity (central bank and consumer finance research on financial
  fragility), unemployment duration data, the cost of a job search, and
  how offers and salary negotiation compound.
- **Dreamer**: the person's own notes first, every dream quoted with its
  date and linked to the note as `/vault/n/<path>`, read under SKILL.md's
  rules on notes (never `secret`, skip `clipped`); then research on
  possible selves (Markus and Nurius), mental contrasting (Oettingen), and
  regret over time (Gilovich and Medvec). A note link counts as a source,
  and at least four of the dreamer's ten are notes.

## 4. Check it

Before writing, check the object with `checkBrain` in
`lib/you/board-brain.ts`, which applies every count above: a `version` of
2; an assessment with a name and text; two to four evidence lines; three to
five questions; eight rules, each ending in a bracketed source; three to six
frameworks; four to eight positions; two to four contrarian views; two to
four disagreements, each naming an advisor key that is on the roster and
is not this advisor; three to five stories, each with a `date` and a
`source` link that is also in `sources`; three to five nevers; a `voice`;
at least ten `sources`, each with a `label` and an `http` link (or, for the
dreamer, a `/vault/n/` note), no link twice.

```sh
npx tsx -e "import {checkBrain} from './lib/you/board-brain'; import fs from 'node:fs';
const b = JSON.parse(fs.readFileSync('<brain.json>','utf8'));
console.log(checkBrain(b, { key: '<key>', roster: [<the other keys>] }))"
```

It prints the problems, or an empty list. Then check by eye what it cannot:
re-read each quote against the passage its subagent copied, and read the
rules aloud as another advisor would. If a rule, a question or a never could
sit in a different advisor's brain unchanged, rewrite it.

## 5. Write it

Put the object in a scratchpad file and send it with `--file`, so the shell
does not touch the quoting:

```sql
update you.board_advisors
set brain = $b${ ... }$b$::jsonb, brain_status = 'ready'
where id = '<advisor id>' and user_id = '<user_id>'
returning id, brain_status, jsonb_array_length(brain->'sources') as sources;
```

## 6. Record it

`scripts/sql.ts` sends one statement per call, so pass the row read in step
1 as the row before:

```sql
select core.record_dash_action('<user_id>', 'you.board_advisors:<advisor id>',
  'update', 'build_advisor_brain',
  $s$Dash built <name>'s advisor brain from <n> sources.$s$,
  $r$<the row from step 1, as json>$r$::jsonb);
```

Read it back: the row is `ready`, its brain has every key above, and
`jsonb_array_length(brain->'sources')` is ten or more.

## 7. When it cannot finish

When fewer than ten sources survive, or the work cannot be read at all,
leave the brain as it was. A rebuild of a brain that was `ready` in step 1
keeps it `ready`, so the advisor keeps sitting on the old brain. A seat
always sits, so a seat whose build fails keeps its old brain, or none, and
its status as it was. Any other row is marked failed, with the reason in
`brain.error`. The Board tab's Advisors view shows that text under the
guest, beside a Try again that runs this file again, so write it for the
person: what was found and what is missing, in a sentence or two, and
nothing in it that is not true.

```sql
update you.board_advisors
set brain_status = 'failed', brain = jsonb_build_object('error', $e$<why, in a sentence or two>$e$)
where id = '<advisor id>' and user_id = '<user_id>';
```

Say in the report which sources were found and what is missing, rather
than padding the list. A guest with a `failed` brain does not sit.

End with a short report: the advisor, its source count, and anything left
out and why.

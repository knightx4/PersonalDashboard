# Building an advisor's brain

A guest advisor sits on the board only once it has a brain: what Dash has
gathered from that person's public work about how they decide. The board
skill briefs a guest with its brain and nothing else (SKILL.md, **The
advisors**), so the brain is the whole of what the guest can say. Build it
from what they wrote and said, cite every part of it, and keep their own
words apart from your summary of them.

**You write one row and nothing else**: the advisor's row in
`you.board_advisors`, its `brain` and `brain_status`. No other rows, no
code, no commits, nothing deleted.

## The brief

The Board tab, when the person adds an advisor, fires the board routine
with:

```
Follow .claude/skills/board/advisor-brain.md
Build advisor <advisor id>
user_id <uuid>
```

A session asked to build the seeded guests, or to rebuild one, does the same
for each row, one at a time, named by its `key`.

## 1. Read the row and claim it

Through `npx tsx scripts/sql.ts` (CLAUDE.md, "Rows are written through
scripts/sql.ts"), every statement scoped to the owner's `user_id`:

```sql
select id, key, name, kind, question, focus, brain, brain_status, active
from you.board_advisors
where id = '<advisor id>' and user_id = '<user_id>';
```

Stop if the row is not there or is a `seat`: seats have no brain. Keep the
whole row as it is now; step 6 passes it as the row before. Then mark it
building, so the tab shows the work under way:

```sql
update you.board_advisors set brain_status = 'building'
where id = '<advisor id>' and user_id = '<user_id>';
```

This is Dash's own bookkeeping and is not recorded; step 6 records the
change the person sees.

## 2. Read their public work

Send subagents, each with one kind of source and the advisor's `name`,
`question` and `focus`:

- **Their own writing**: books, shareholder or annual letters, essays,
  letters, notebooks, speeches as delivered, testimony.
- **Their own voice**: talks, interviews, podcasts, oral histories, with a
  transcript where one exists.
- **What others established**: well-sourced biographies, museum and archive
  pages, editors' notes in a papers edition. For a historical figure, prefer
  a scholarly edition of their papers (Founders Online, a museum's
  catalogue) and public-domain texts (Project Gutenberg, Wikisource) to
  anything recent.

Each subagent returns, for every source it read, a label (title, year,
publisher or venue), a link, and the passages that bear on how the person
decides, **copied verbatim from the page it opened**, each marked with
where it sits. A passage it remembers but did not read on the page comes
back as a paraphrase, never as a quote. Quote collections and "best
quotes" pages are not sources: many lines on them were never said.

Check each link opens: `curl -sL -o /dev/null -w '%{http_code}'`, or a
fetch. A page that refuses the check (a 403 from a bot wall, a
JavaScript challenge) stays only when a search result shows that page
under that title. A dead link is replaced or dropped, never kept.

Aim for twelve or more sources so ten survive the check. A brain needs **at
least ten linked sources**; with fewer, go to step 7.

## 3. Write the brain

`brain` is one jsonb object:

```
rules       [ text ]               eight, each one sentence or two
frameworks  [ { name, text } ]     three to six named ways of thinking
positions   [ { topic, text } ]    four to eight stances on recurring questions
stories     [ { text, source } ]   three to five stories, source a link
voice       text                   how they talk, in three or four sentences
sources     [ { label, link } ]    every source read, ten at least
```

- **The question.** The row's `question` is the one question this advisor
  owns. Keep it when the person wrote it. When it is empty or a placeholder
  (the tab writes "What would <name> make of this?" for a guest the person
  adds), write one from the brain, in their terms and addressed to "you", and set
  it in the same update.
- **Rules** are what they decide by, eight of them, each with its source in
  brackets at the end: `(1996 letter)`. Write them as instructions the guest
  can apply to the person's choice.
- **Frameworks** are their named ways of thinking (circle of competence,
  the OODA loop, moral algebra), each with what it is and how to use it.
- **Positions** take the topics a board question keeps raising: risk,
  money, mistakes, career moves, time, people, failure, saying no. Write
  the stance they took and where they took it.
- **Stories** are things that happened that they told, or that a sound
  source records, with the link in `source`.
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

## 4. Check it

Before writing, check the object: eight rules; three to six frameworks;
four to eight positions; three to five stories, each with a `source` link
that is also in `sources`; a `voice`; at least ten `sources`, each with a
`label` and an `http` link, no link twice. Re-read each quote against the
passage its subagent copied.

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
sets it back to `ready`, so the guest keeps sitting on the old brain; any
other row is marked failed, with the reason in `brain.error`. The Board
tab's Advisors view shows that text under the guest, beside a Try again that
runs this file again, so write it for the person: what was found and what is
missing, in a sentence or two, and nothing in it that is not true.

```sql
update you.board_advisors
set brain_status = 'failed', brain = jsonb_build_object('error', $e$<why, in a sentence or two>$e$)
where id = '<advisor id>' and user_id = '<user_id>';
```

Say in the report which sources were found and what is missing, rather
than padding the list. A guest with a `failed` brain does not sit.

End with a short report: the advisor, its source count, and anything left
out and why.

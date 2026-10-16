# Learn: essays

A writing mode in Learn. You write short essays, 200 to 2,000 words, about
what you have been learning. Each one is a note in your vault from its first
save, and the finished ones can go on selveyknight.com. Dash helps with
everything around the sentences: sharpening the question, finding what you
already wrote and read, pointing at gaps, and checking claims. It does not
write the essay.

Written to [WRITING-GUIDE.md](WRITING-GUIDE.md). The decisions below were made
by the owner on 12 October 2026, after a survey of Lex, Copilot for Obsidian,
Smart Connections, iA Writer, NotebookLM, Elicit, Consensus, Khanmigo and the
research on AI writing help. On 15 October 2026 the owner's first essay
showed the interview ending on an empty editor and research too hard to use;
six planning stages were tried that day and replaced the same evening by
"Notes first", below, which fits how the owner writes.

---

## Why this exists

Reading and quizzes leave nothing behind that you can point to. An essay
does. It is also the hardest test of whether you understood something,
because you have to put the pieces in order yourself and say what you think.

Two things follow from that, and the rest of the spec is built on them.

- **You write the prose.** The learning happens while you form the
  sentences. Studies of AI writing help found that help at the paragraph level
  raises output and lowers the writer's sense that the piece is theirs
  (Dhillon et al., CHI 2024). An essay Dash drafted is not something to show
  for your learning.
- **The essay has to be good enough to publish.** That is what makes it
  worth finishing. So Dash's job is to be a demanding first reader: one that
  has read your whole vault and everything you studied.

## What Dash does, and how far it goes

Every kind of help sits on a ladder. Dash starts at the bottom and climbs only
when you ask.

| Rung | What Dash gives | Example |
|---|---|---|
| 0 | A marker in the margin, nothing more | a dot beside the paragraph |
| 1 | One question | "What would someone who disagrees say here?" |
| 2 | A hint that names the problem and where it is | "The second paragraph claims X; nothing before it supports it." |
| 3 | An example from a different topic, or two or three one-line directions | "You could narrow the claim, add the case from your Walzer note, or cut it." |
| 4 | A suggested sentence, as a change to the text you selected | shown struck through and replaced, with accept and reject |

Rules for the ladder:

- Dash never goes past rung 2 unless you ask. "Help" on a note moves it up one
  rung. "Rephrase" on a selection goes straight to rung 4 for that selection.
- At most three margin notes are open at once. More wait until one is closed.
- A check you dismiss twice in one essay does not run again on that essay.
- Every note has an "Explain" that says why Dash raised it.
- Rung 4 only ever changes the text you selected, shown as a diff you accept
  or reject. Dash never rewrites a paragraph you did not select, and never
  rewrites the whole essay.
- Text you accept from rung 4 is marked as Dash's (see "Who wrote what"). It
  becomes yours when you rewrite it.

## Notes first

Decided by the owner on 15 October 2026, after using the six planning stages
built that morning: "I like to just write down a lot of scratch notes … go
through all those points and develop them … eventually I figure out a
structure along the way … I don't want to manually do much at all other than
write my raw thoughts down, tweak the writing, and answer some questions."

The owner writes by discovery (Galbraith 1999, 2009; Elbow's loop writing):
ideas form while producing text and structure appears late. A planner's
sequence of question, thesis, points and outline, kept by hand, gets in the
way. So the rule is: **the person only writes. Dash keeps everything else,
and the person corrects Dash by writing, never by editing what Dash made.**

An essay has three tabs, **Prepare**, **Notes** and **Draft**, switched at
the top of the page. It opens on the draft once the draft has 150 words, and
on the notes otherwise. Notes and Draft hold an editor and nothing else.
Prepare holds everything else, one card under another in the same column:
the brief, the map, From your notes, the checks, what you studied, research,
the length and the vault note, Finish and Publish. They sat in a rail beside
the editor until 16 October 2026, when the owner found the page hard to read
with both side by side. What Prepare puts into the draft (a link, a quote, a
footnote) goes in where the cursor was, and the page moves to the Draft tab
to show it.

**Notes.** One editor for everything the person thinks: claims, examples,
doubts, fragments, quotes, in any order. It saves itself a moment after they
stop typing. An essay with no notes yet opens on what was already written for
it (the brief's answers, replies to Dash, points and answers from the earlier
stages, takes on research), so nothing is lost. The brief sits on Prepare.

**The map.** On Prepare, Dash's map of the notes, made only when the person
presses **Update the map** (one Sonnet call, a few cents). It shows:

- what they seem to be arguing: one to three of their own sentences;
- their threads: the three to seven things the notes keep returning to, each
  with a short name in Dash's words, the passages that belong to it, whether
  the notes hold it up (nothing yet, thin, supported) and what is missing,
  in the order an essay could take once there is enough to suggest one;
- where the notes pull against each other;
- one to three questions aimed at the biggest gap or tension.

Every passage shown is the person's own, kept only when it is in the notes
word for word. The map is read-only. A question is answered in place and the
answer is added to the end of the notes. The map never changes on its own.

**Sources on a thread.** Each thread has **Find sources for this**: the
rule that applies, evidence for it, the strongest objection, a real case.
Each is one Sonnet call with up to four web searches, told to cite the
primary document, label who published each source (the address overrules
the model's label where it is plain), and say when guidance has been
superseded. Up to three cited items wait beside the thread; **Add the quote
to my notes** puts the quoted words and the address at the end of the notes.

Why per thread: on 15 October an evaluation found practitioner essays of
this length for a CFO-office reader rest on one to three sources, mostly the
rule the reader answers to, with the author's own experience carrying the
rest; and the whole-question research had cited vendor blogs and write-ups
of a standard rather than the standard, and missed that SR 11-7 had been
rescinded.

**Vault notes.** A vault note can be attached to an essay's notes, by asking
Dash in Ask or in another chat through the connector (`attach_vault_note`,
`learn.essay_vault_notes`). Nothing is copied into the notes. Prepare lists
the attached notes under the map, each linking to the note, with Remove.
Update the map reads their text after the notes, and a passage quoted from one
counts as the person's own words, as a passage from the notes does. Added on
16 October 2026, so research kept in the vault from other chats can feed an
essay without being pasted in.

**Draft.** The writing surface below. On Prepare, **From your notes**:

- **Assemble a draft** lays the person's own passages out in the map's order:
  their lead claim, then each thread as a heading in Dash's words with its
  passages under it, and a "[Gap: …]" line where the notes do not hold it
  up. The headings and gap lines carry Dash's mark, so "Your words" stays
  honest; every other word is theirs. On a draft with words in it the press
  asks once more before replacing it.
- **Write a model draft** has Dash write the essay from the notes, at the
  word target, faithful to what they argue and marking gaps rather than
  filling them. It is shown folded under the draft, labelled as Dash's, and
  never put into it: a sparring partner, at the ownership cost Dhillon et al.
  (CHI 2024) measured, which is why it stays apart.

The interview and the six stages (Discover, Research, Plan, Structure,
Develop, Write) are gone. What they wrote is kept in the plan and seeded
into the notes.

## Measuring the tool

`learn.essay_log` (migrations learn 0133 and 0134) keeps a row each time the
notes or the draft is opened, so where people stop is visible, and each model call the stages make
with its response, the encrypted search payloads left out. Saved responses
go in `lib/learn/essays/fixtures/recorded/`, where a test replays them through
the parsers. `fixtures/gold-sox-ai.json` is the gold list for the test essay
and `gold.ts` scores a run's sources against it for recall and precision.

## The writing surface

The editor is CodeMirror 6, the same editor Obsidian uses. It edits the
markdown text itself, so saving changes only what you typed. Every rich-text
editor we looked at (Tiptap, Milkdown, Lexical, BlockNote) parses markdown into
a tree and prints it back, which rewrites `*x*` as `_x_`, escapes
`[[wikilinks]]` and drops frontmatter. That would put formatting noise into
the vault on every save.

What the page looks like while you write:

- One column, about 66 characters wide, body text at 19px with line height
  1.6.
- The page scrolls only when the line you are typing comes within a third
  of the screen of the bottom, and then only as far as it must. It used to
  re-centre on every keystroke, which moved the page under you.
- Markdown symbols are dimmed rather than hidden. Headings are larger.
- A word count at the bottom, against a target if you set one.
- The tools stay where they are while you type. Hiding them on the first
  keystroke moved the text up the page each time.
- Margin notes are small markers in the right margin. Pressing one opens it
  on Prepare.
- An optional focus mode dims everything except the current paragraph.
- Laptop first. On a phone the page is readable and editable, without the
  study panel.

Saving:

- The draft saves to the database as you type, silently. A save that fails
  says so.
- The essay is written to the vault when you press Cmd-S, when you leave the
  page, and after five minutes without typing if there are unsaved changes.
  Each of those is one commit. This is the vault write-back that already
  exists (`saveNote`, `createCapturedNote`), with its check that the note has
  not changed since it was opened.
- For now essays are edited only in the app. If the note was changed in
  Obsidian anyway, the save stops and offers to reload, as the note editor
  does today.

## The essay note

Every essay is a note in the vault's `Essays/` folder, named from its title.
The frontmatter:

```yaml
title: "Why money is the odd good out"
type: essay
stage: draft          # draft | seedling | budding | evergreen
publish: false
slug: money-odd-good-out
description: "One sentence saying what the essay argues."
created: 2026-10-12
updated: 2026-10-12
published:            # set the first time it is published
tags: [economics]
confidence: likely    # optional: certain, highly likely, likely, possible, unlikely, highly unlikely, remote
sources: ["[[Walzer - Spheres of Justice ch4]]", "https://..."]
```

- `type: essay` is how the app finds essays, wherever they sit in the vault.
- `stage` is both the private state and the public label. A `draft` is never
  published.
- `slug` keeps the essay's web address fixed when the title or file name
  changes.
- Dates are `YYYY-MM-DD`; wikilinks in frontmatter are quoted, which Obsidian
  requires.
- Comments, margin notes, research runs and word targets live in the database,
  not in the note.

### Who wrote what

The note ends with an authorship block in iA Writer's open Markdown
Annotations format (v0.2, `iainc/Markdown-Annotations`). iA Writer and the
Obsidian Authorship plugin both read it.

```
...the last paragraph of the essay.

---
Annotations: 0,1834 SHA-256 8642505e205f8a563b8b6c376bef88a1
@Selvey: 0,1700
&Dash <claude-sonnet-5-5>: 1700,96
*Walzer - Spheres of Justice ch4: 1796,38
...
```

- `@` is you, `&` is Dash, `*` is a quote you inserted from a note or source.
- Ranges are grapheme counts from the start of the file, as the spec defines
  them. The hash covers the annotated text, so another editor's change is
  detected.
- Dash's text is known exactly, because Dash inserts it itself. Nothing is
  guessed from pastes.
- Undo restores the author the text had. (The Obsidian plugin gets this wrong:
  undoing the deletion of AI text marks it as yours.)
- The block is rewritten only when the note is written to the vault, not on
  every keystroke. In the app's editor it is hidden.
- If the hash does not match when the app opens the vault's version of the
  note, the app says the note was edited elsewhere and asks whether to keep
  the marks (shifted to the best match) or clear them.
- The block is removed from anything published.

**"Your words"** is shown on the essay page as a percentage: your graphemes
divided by yours plus Dash's. Quotes, whitespace and markdown symbols are left
out of both. The rule is written next to the number.

## Margin notes and checks

Checks are named, and each one is a single instruction. You run them from the
side of the page, one at a time or a set at once. Nothing runs on its own
while you type, except the local checks, which cost nothing and only show a
marker.

Each check is either **local** (pattern matching, no model) or **model** (one
call per paragraph, Sonnet). The first set:

| Check | Kind | What it looks for |
|---|---|---|
| The Claim | model | Is there one claim the essay argues, and does it match the brief? |
| So What | model | Would the reader in the brief care, and does the essay say why they should? |
| Earned Ending | model | Does the conclusion follow from what came before it? |
| Counterpoint | model | The strongest objection the essay does not answer. |
| Missing Step | model | A step in the argument the reader has to supply. |
| Already Said | model | Where the essay contradicts or repeats something in your own notes, with the note linked. |
| Fact to Verify | model | Claims of fact that need a source and have none. |
| Writing guide | local, then model | The four failure modes in WRITING-GUIDE.md, through `lib/writing/check.ts`. |

Revision suggests the order Khanmigo uses: claim and focus, then evidence and
reasoning, then structure, then language. The page suggests it; it does not
enforce it.

A margin note is anchored to the text it is about. While the editor is open
the anchor moves with your edits. In the database it is stored as the quoted
text with about 32 characters either side and the offset as a hint, and it is
found again on load by offset, then exact quote, then a fuzzy match. A note
whose text was deleted is shown as detached, not dropped.

## From your study

A panel beside the draft lists what you already have that bears on the
paragraph you are writing: vault passages, your positions from the vault map
with their checked quotes, readings with their located passages, clips, card
notes and learning-log entries.

- It searches with the current paragraph, after you pause typing for about
  two seconds, not with the whole note.
- Each item shows the sentence that matched, so you can see why it is there.
- Below a similarity floor, nothing is shown. Scores are not displayed.
- Pinned items (from the brief) are always listed first, and always reach
  every check in full.
- Clicking an item inserts a `[[link]]` or the quote, marked `*` in the
  authorship block.
- You can hide an item for this essay.

Vault notes are embedded today as whole notes, which is too coarse to show a
matching sentence. This feature adds embeddings by heading block, keyed by the
note and its heading path, re-embedded only when a block's text changes.

## Research, when you ask

No search runs without you pressing a button, and every button shows its
price before it runs. There are two levels.

| | Research the question | Check the draft's claims |
|---|---|---|
| What it does | One Sonnet call with up to 8 web searches. It is told the question, the writer's answer so far, the reader and what would change their mind, and that the writer knows the field. It writes where the debate stands, then up to four items each of evidence for the answer, evidence against it, and material the writer could use (a framework, a figure, a case, a line to quote), then up to three questions for the writer | Up to 8 searches and 5 full pages read; each claim in your draft marked supported, opposed or mixed, with the quote |
| Typical cost | $0.25 to $0.45 | $0.15 to $0.60, shown as "up to $0.60" |
| Model | Sonnet, with the dynamic-filtering web search | Haiku gathers, Sonnet judges |

The research card sits beside the notes and the draft. It shows where the
debate stands first, then what supports the answer, what pushes back and
what the writer could use, each a headline, a sentence or two and its
sources, with Insert putting a quote at the cursor as a footnote. An item
with no citation is dropped.

The writer's answer, reader and what would change their mind go to the model
as context, and the model is told never to paste their words into a search.
The origin answer, which often quotes the vault, is not sent.

History: until 15 October 2026 the first level was one Haiku call listing
positions. For one day it then framed the question into parts, read five
pages and wrote only from them; on the owner's first essay it read three
pages about one announcement and answered most parts with "the pages do not
say", so it was replaced by the call above. Older runs still show in their
own layout.

**Haiku and web search** (checked 12 October 2026, plan #1863.9). Haiku
takes the basic tools, `web_search_20250305` and `web_fetch_20250910`, but
not the dynamic-filtering versions (`_20260209` and later), which need
programmatic tool calling and are listed for Opus and Sonnet only. Jobs'
company lookup has run the basic search on Haiku 4.5 since September, and
Haiku 5.5's list of breaking changes does not touch the web tools, so the
first pass runs on Haiku. Searches cost $10 a thousand on any model; web
fetch costs only the tokens it reads. The first pass's guess is about $0.10:
four searches ($0.04) and the search results, which every round of the
server's loop reads again and which take the prompt past Haiku's
100,000-token line to its long-prompt rate. On Sonnet the same run would be
about $0.30. The $ hint shows the guess, marked uncertain, until five runs
have been measured.

- Searches use Anthropic's web search tool with `max_uses` as the hard cap.
  The deeper pass fetches pages with the web fetch tool and keeps their text,
  so a citation can open at its passage.
- Nothing is cited unless it was retrieved. Citations come from the API's own
  citation ranges, never from text the model wrote about a source.
- The count of supporting and opposing sources says it counts sources and
  does not weigh them.
- Vault text never goes into a web search query. The first pass sends the
  brief's question, your answer, your reader and what would change your
  mind, and is told to search in general terms and never paste your words.
  The deeper pass has to read the draft to know its claims, and is told to
  search in general terms and never paste a sentence of it; your other
  notes, the pinned items and the origin answer are never sent.
- Every run records its real cost from the API's usage, through the Learn
  spend record.

Citations in the essay are informal footnotes, numbered by first use, one per
source:

```markdown
Weekend lie-ins don't repay lost sleep.[^1]

[^1]: [The myth of catch-up sleep](https://example.org/x#:~:text=weekend%20recovery%20sleep) · example.org
```

The link carries a text fragment, so it opens the page scrolled to the quoted
words. There is no reference list heading. A research run's summary can be
kept in the note as a folded callout, or not at all.

## Finishing and publishing

"Finish" does four things:

1. Sets `stage` to at least `seedling` and writes the note to the vault.
2. Logs the essay in Learn's learning log, with the claims it argues, so Learn
   knows you have written about the topic.
3. Offers short notes for new claims the essay makes that are not yet in the
   vault. You choose which to create. They go in `Inbox/`.
4. Offers to add the essay to the evidence bank in Jobs, as something you can
   demonstrate.

One Sonnet call reads the essay (without its footnotes) and names two to eight
claims. The learning-log entry holds those claims and the essay's id, and
pressing Finish again updates that entry. A claim counts as already in the
vault when a note is close enough to it (similarity 0.78 or more), and such a
claim gets no offer. The notes and the evidence item are made only for what
you tick: each note is a heading, the claim and a link back to the essay; the
evidence item is one row in the bank whose story links to the essay, made
once an essay. A stage a note already has beyond seedling is kept.

"Publish" puts the essay on selveyknight.com:

- The site reads the same Supabase project as the dashboard, as its Ask my AI
  tables already do. Publishing copies the essay into a published snapshot, so
  later edits do not appear on the site until you publish again.
- The snapshot has the authorship block removed, footnotes kept, and every
  `[[wikilink]]` turned into plain text unless it points at another published
  essay. Private note titles do not leak.
- The site reads published essays through two functions open to the anonymous
  key: one lists them, one returns one by slug. Neither can read a draft.
  They are `public.published_essays()` and `public.published_essay(p_slug)`,
  and they return only the owner's essays. A link between published essays
  points at `/writing/<slug>`. When an essay is unpublished, the links other
  essays make to it become plain text.
- The site gets a Writing page listing essays newest first, with title,
  description, stage and date, and a page per essay showing its stage,
  confidence and the dates it was published and last updated.
- "Unpublish" removes the snapshot. The note in the vault is unchanged.

## Schema

All in the `learn` schema, created by migrations in `supabase/migrations-learn/`
and applied to the live project in the same sitting.

- **`learn.essays`**: one row per essay. The vault note it is
  (`note_id`, `path`, `blob_sha`), the draft body as last typed, whether it
  has unsaved changes, the brief (the five answers, pinned items and where
  the interview has got to), the
  word target, the authorship ranges as the note has them, the same marks on
  the draft (`draft_authorship`, counted in the draft's own characters, since
  the draft is often ahead of the note), the published snapshot (`published_body`,
  `published_at`, `slug`), when it was finished (`finished_at`), the id of its
  evidence-bank item (`evidence_item_id`), and timestamps. A **source** in the catalogue: it
  holds what the person wrote.
- **`learn.essays.plan`** (migration 0132): the guided stages' work, in the
  person's words apart from Dash's questions and notes: the thesis, Dash's
  read of the brief with the replies, the takes on the research keyed by run
  and part, the points in order with each one's role, what its part does, and
  the questions asked about it with the answers, the chosen shape, and Dash's
  notes on the plan.
- `learn.essay_research` gains
  `summary` (the short answer) and `asks` (the questions for the writer).
- **`learn.essay_notes`**: margin notes. The essay, the check that raised it,
  the rung, the body, what it says at rungs 1 to 3 and why it was raised
  (so Help needs no second call), the anchor (quote, prefix, suffix, offset
  hint), and whether it is open, waiting for one of the three open places,
  done, dismissed or detached. Not a source: Dash wrote it.
- **`learn.essay_research`**: research runs. The essay, the level, the
  questions searched, the sources with their kept text, the citations, the
  per-claim counts, and the cost. Not a source: it is what Dash retrieved.
- **`obsidian.note_blocks`**: vault notes split by heading, with the heading
  path, character range, text hash and embedding. Not a source: it is an index
  of notes that are already one.

Each goes in its module's `sources.ts`, and `npm run sources:write` runs after.

## What this is not

- **Not a drafting tool.** There is no "write it for me". The highest rung is
  a suggested sentence for text you selected.
- **Not a chat.** Help is attached to the text it is about, as a margin note
  or a change to a selection. The back and forth in the stages is Dash asking
  and the person answering, and the answers are kept as the person's notes. A side chat that edits the document is how
  Canvas ends up rewriting text the writer did not ask it to touch.
- **Not a research assistant that runs by itself.** Research is two buttons
  with a price on each.
- **Not academic writing.** No citation styles, no bibliography, no reference
  manager.
- **Not a second copy.** The vault note is the essay. The database holds what
  the vault cannot: the unsaved draft, notes, research and the published
  snapshot.

## Rules

**R1.** An essay is a vault note with `type: essay`, and the database row
points at it.
Checked by: audit.

**R2.** Dash's text in an essay appears only from a rung-4 suggestion the
person accepted, and is marked `&Dash` in the authorship block.
Checked by: audit.

**R3.** No research run starts without the person pressing its button, and
each run's real cost is recorded.
Checked by: audit.

**R4.** A published essay contains no authorship block and no link to an
unpublished note.
Checked by: audit.

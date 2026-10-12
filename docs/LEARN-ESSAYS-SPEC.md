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
research on AI writing help.

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

## Starting an essay

An essay starts from a question, not a topic. "New essay" opens a short
interview: Dash asks one question at a time, at most five, and never says
anything like "That sounds interesting". The questions are fixed in kind:

1. What is the question you want to answer?
2. What do you think the answer is, right now, in a sentence?
3. Who is it for? (A friend who knows nothing about it is the default.)
4. What made you think this? (Dash offers what it found in your study, below.)
5. What would change your mind?

Your answers, in your own words, become the **brief**: question, claim,
reader, what made you think it, what would change your mind, and the notes
and readings you pinned. The brief sits above the
draft, folded, and every check reads it. You can skip the interview and fill
the brief in yourself, or leave it empty.

Learn suggests essays, and you start one from the suggestion with the brief
already half filled:

- a learning goal you finished, from its plan page;
- two readings you saved that disagree, from either reading;
- a theme on the vault map with several of your positions in it;
- an entry in the learning log with ideas you have not written about.

These are buttons on pages that exist. Learn does not push essay prompts into
the Now deck.

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
- The line you are typing stays in the middle of the screen.
- Markdown symbols are dimmed rather than hidden. Headings are larger.
- A word count at the bottom, against a target if you set one.
- No toolbar while you type. The tools come back when you move the mouse.
- Margin notes are small markers in the right margin until you hover or open
  one.
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

| | First pass | Deeper pass |
|---|---|---|
| What it does | Up to 4 web searches on the essay's question; 3 to 5 positions, each with sources | Up to 8 searches and 5 full pages read; each claim in your draft marked supported, opposed or mixed, with the quote |
| Typical cost | $0.05 to $0.18 | $0.15 to $0.60, shown as "up to $0.60" |
| Model | Haiku if it supports web search, otherwise Sonnet | Haiku gathers, Sonnet judges |

- Searches use Anthropic's web search tool with `max_uses` as the hard cap.
  The deeper pass fetches pages with the web fetch tool and keeps their text,
  so a citation can open at its passage.
- Nothing is cited unless it was retrieved. Citations come from the API's own
  citation ranges, never from text the model wrote about a source.
- The count of supporting and opposing sources says it counts sources and
  does not weigh them.
- Vault text never goes into a web search query.
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

"Publish" puts the essay on selveyknight.com:

- The site reads the same Supabase project as the dashboard, as its Ask my AI
  tables already do. Publishing copies the essay into a published snapshot, so
  later edits do not appear on the site until you publish again.
- The snapshot has the authorship block removed, footnotes kept, and every
  `[[wikilink]]` turned into plain text unless it points at another published
  essay. Private note titles do not leak.
- The site reads published essays through two functions open to the anonymous
  key: one lists them, one returns one by slug. Neither can read a draft.
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
  `published_at`, `slug`), and timestamps. A **source** in the catalogue: it
  holds what the person wrote.
- **`learn.essay_notes`**: margin notes. The essay, the check that raised it,
  the rung, the body, the anchor (quote, prefix, suffix, offset hint), and
  whether it is open, done, dismissed or detached. Not a source: Dash wrote
  it.
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
  or a change to a selection. A side chat that edits the document is how
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

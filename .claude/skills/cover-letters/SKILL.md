---
name: cover-letters
description: Write the cover letter an application's Draft button queued in job_search.cover_letter_requests, with the person's own cover letter skill (anthropic-skills:selvey-cover-letters), from everything on file that scripts/cover-letter.ts prints, and save it beside the editor through the same script. The app queues the letter here instead of calling the API. Use when the goals routine is fired with a brief that starts "Follow .claude/skills/cover-letters/SKILL.md" and names "Cover letter <id>", or the user says "write the waiting cover letter".
---

# Writing a cover letter the Draft button queued

When the person presses Draft a cover letter (or Redraft, with replies to
Dash's questions) on an application, the app no longer calls the API. It
saves their replies, writes a row in `job_search.cover_letter_requests` and
fires this routine. You write the letter yourself, with their cover letter
skill, and hand it back through the script, which checks it the way the API
reply was checked and keeps it beside the editor. The tab polls the row and
shows the letter when you save it.

**You change rows, not code.** Do not commit or push. Do not delete anything.
Never send anything to the company and never submit an application. In
anything the person reads (the letter, the asks, a failure reason), the
assistant is **Dash**, never "Claude".

## 1. Read the brief

```
Follow .claude/skills/cover-letters/SKILL.md
Cover letter <request id>
user_id <uuid>
application <application id>
```

Work from the repository root. If `node_modules` is empty, run `npm ci` first.

## 2. Load the cover letter skill

Invoke `anthropic-skills:selvey-cover-letters` with the Skill tool. If it is
not in your skill list, read it from
`~/.claude/skills/synced/*/selvey-cover-letters/SKILL.md`. If neither
exists, run `npm run cover-letter -- fail <id> "The cover letter skill is not available to the routine."`
and stop: the person asked for that skill, so do not fall back to another
template.

That skill decides the letter: its voice, structure, closing line, style
rules and the facts it allows and forbids. Follow it from section 1 to
section 5. Two of its steps work differently in a routine:

- **Reading the draft already in the box (its section 1).** There is no
  browser here. The script prints the letters already on file (earlier
  letters to this company, the current Dash draft under "Your previous
  draft") and you read `applications.cover_letter` yourself:
  `npx tsx scripts/sql.ts "select cover_letter from job_search.applications where id = '<application id>' and user_id = :owner"`.
  When it holds a draft, start from it and keep its strong lines, as the
  skill says.
- **Saving (its section 6).** Do not write `applications.cover_letter` and do
  not set `has_cover_letter`. The letter goes beside the editor through the
  script in step 4, and the person inserts and saves it themselves. Your
  flagged lines go in `unsupported_claims`, which the tab shows under the
  draft.

## 3. Read the material

```sh
npm run cover-letter -- show <request id>
```

This marks the request as drafting and prints:

- `material`: everything on file for the application, rendered as the API
  call was given it. The role and posting, company research, the Perspective
  tab, earlier letters to the company, the evidence bank (each item with its
  `id:` line), the résumé, past answers, their thinking about the search,
  notes, and how they write.
- `request_text`: the answers already on this application (the letter must
  agree with them), where they match the role best, their notes on building
  with AI, their comments on the letter, their replies to earlier asks, and
  the previous draft when there is one. A redraft revises the previous draft
  with the replies; keep what still works.
- `evidence_ids`, `banned` (their banned constructions; the app flags any
  that appear) and `report`, the JSON shape to save.

The skill also asks for the Yale transcript when a course is named and quick
research on the company. The Dash connector (`mcp__Dash__courses`,
`mcp__Dash__recall`, `mcp__Dash__open_row`) and WebSearch serve those when
they are there; load each with ToolSearch. When the material already covers
the company, a search is optional. Read only the owner's rows.

Where the material's comments or replies from the person ask for something
(a length, an angle, a point to make or leave out), follow them over the
skill's defaults. They are the person's own words about this letter.

## 4. Save

Write the report as JSON to a file in your scratchpad:

```json
{
  "letter": "Dear … Hiring Team:\n\n…\n\nSincerely,\n\nSelvey Knight",
  "evidence_item_ids": ["<ids from the material that the letter draws on>"],
  "unsupported_claims": ["<every line not confirmed by the evidence bank, the transcript or their own words, verbatim>"],
  "asks": ["<up to four short questions whose answers would make the letter better>"]
}
```

The letter has no subject line, date or address block. Ask only what the
material and earlier replies do not already answer, such as why this role
when nothing says. Then:

```sh
npm run cover-letter -- save <request id> <file>
```

- `"ok": true` prints the word count, any banned construction it found and
  the asks kept. When `banned_found` is not empty, rewrite those lines and
  save again.
- `"ok": false` says why the report did not check. Fix it and save again, at
  most twice. If it still fails, run
  `npm run cover-letter -- fail <request id> "<why, in one sentence>"`.

End with one line: the role, the word count, and how many lines you flagged.

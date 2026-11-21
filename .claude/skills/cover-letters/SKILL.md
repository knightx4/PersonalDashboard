---
name: cover-letters
description: The one skill for writing Selvey's cover letters, for every kind of role (AI, finance, credit, audit, strategy). Reads everything on file for the application through scripts/cover-letter.ts, works out how much the role is about AI and leads the letter accordingly, writes it in Selvey's voice with only confirmed facts, and saves it beside the editor through the same script. Use when the goals routine is fired with a brief that starts "Follow .claude/skills/cover-letters/SKILL.md" and names "Cover letter <id>" (the Draft button), or when the user asks for a cover letter for a role or application, says "write the waiting cover letter", or asks to redraft one.
---

# Writing Selvey's cover letters

This is the only cover letter skill. It holds the voice, the structure, the
facts and the mechanics. It replaces `anthropic-skills:selvey-cover-letters`:
do not load that one as well, since the two would disagree.

**You change rows, not code.** Do not commit or push. Do not delete anything.
Never send anything to the company and never submit an application. In
anything the person reads (the letter's notes, the asks, a failure reason),
the assistant is **Dash**, never "Claude". The letter itself may say Selvey
uses Claude, since that is a fact about their tools.

## 1. Get a request

From the Draft button, the brief is:

```
Follow .claude/skills/cover-letters/SKILL.md
Cover letter <request id>
user_id <uuid>
application <application id>
```

When the person asks you directly in a session, queue one yourself with the
application's or the role's id (find it with the Dash connector's `search`
or `job_applications`, or through `scripts/sql.ts`):

```sh
npm run cover-letter -- start <application or role id>
```

It prints the request id. From here both paths are the same. Work from the
repository root; if `node_modules` is empty, run `npm ci` first.

## 2. Read everything

```sh
npm run cover-letter -- show <request id> > <scratchpad>/show.json
```

This marks the request as drafting and prints JSON. Read all of it (it is
long; read the file with `allow_large`):

- `ai_weight`: `central`, `some` or `none`. It decides the letter's shape
  (section 4). Write it down before anything else.
- `material`: the role and posting with its requirements, company research,
  their Perspective tab, earlier letters to this company, the evidence bank
  (each item with its `id:` line), the résumé, past answers, their thinking
  about the search, notes, and their writing-style notes with standard lines.
- `request_text`: what this letter must agree with and draw on. The answers
  already on this application, where they match the role best, **their
  notes on building with AI**, their comments on the letter, their replies
  to earlier asks, and the previous draft when there is one. A redraft
  revises the previous draft with the replies and keeps what still works.
- `evidence_ids`, `banned` (constructions the save refuses) and `report`.

Then read the box's current text, which the material does not carry:

```sh
npx tsx scripts/sql.ts "select cover_letter from job_search.applications where id = '<application id>' and user_id = :owner"
```

When it holds a draft, start from it and keep its strong lines.

When a course is named, check it in the Yale transcript (the Dash
connector's `courses`; load it with ToolSearch). When the material says
little about the company or team, a quick WebSearch makes the "why this
company" part specific. Read only the owner's rows.

## 3. What decides what

In order, the first wins:

1. The person's comments on the letter and replies to earlier asks
   (`request_text`). They are what they want this letter to say: a length,
   an angle, a point to make or leave out.
2. This skill, including the AI weight in section 4. Where their
   writing-style notes say AI gets one sentence, that holds for `some` and
   `none` roles only.
3. Their standard lines in the writing-style notes. Use them as written
   where they fit, except any line the facts in section 7 rule out.

## 4. The shape, by how much the role is about AI

About 300 to 400 words, four or five paragraphs, after "Dear [team] Hiring
Team:" (or the person the material says they are writing to). Every letter
answers three things: why this role, why this company, why Selvey fits.

**When `ai_weight` is `central`** (the role is about AI: an AI generalist,
AI strategy, AI enablement, building with agents), AI leads.

1. Opening: the role by its exact title and team, then why AI work, in their
   own reason (their notes on building with AI, the Perspective tab, their
   comments). Then the one-line credential. The opening says this is
   someone who builds with AI, not a finance person who also uses it.
2. Building with AI: what they built and what it showed them, from their
   notes on building with AI and the evidence bank. Name the system and
   what it does: a personal dashboard that brings their data into one place
   and directs AI agents to plan and build its own features, each step
   approved by them, running while they are away; an AI tool that answers
   questions from years of their own notes. Then one thing it taught them
   that this role needs, said the way their notes say it (fast experiments
   against a clear scoring metric, a human setting the goal, the metric and
   the guardrails; treating AI output like audit evidence, with preventative
   and detective checks). Tie it to what the posting asks for.
3. EY, mapped to the posting: the automated revenue testing tool (they led
   the strategy and the client's data requirements, the build replaced
   sampling with a check of 100% of recognized revenue, they trained the
   staff), framed as automating real work for real users. Add the
   requirements-gathering or client story only when the posting asks for
   working with stakeholders.
4. Optional: teaching and explaining (Yale TA, Executive MBA tutor) when the
   posting asks for explaining technology to non-experts.
5. The close.

**When `ai_weight` is `some` or `none`**, the role's own field leads.

1. Opening: the role by its exact title and team, why it fits, the one-line
   credential.
2. One or two stories mapped to what the posting asks for, with scope and
   results, from their standard EY lines and the evidence bank.
3. A paragraph tied to the posting's stated priorities and the company's
   specifics, showing how their background meets them: education, the
   startup advisory work, or a second EY story. AI gets one sentence near
   the end of this paragraph, from their standard AI line, and only for
   `some`; never a suggestion that the team should be using AI.
4. The close.

**The close, always:** "I would welcome the chance to learn more about the
role and to discuss how I can contribute to the team." Then "Sincerely," on
its own line, a blank line, and "Selvey Knight". Nothing else in the close:
no thanks paragraph, no summary, no new topic.

## 5. Voice

Write as a top candidate who is an experienced professional and expert in
the role's field (AI, finance transformation, credit, audit). Traditional,
professional register; American spelling. Credentials early. Answer first,
then the proof. Do not explain obvious things (what lending is, what an
audit is, what an LLM is). Never open with the "fixed income gives a direct
read on the economy" line; it can be a supporting point in credit letters.
Client work is collaborative: working through a disagreement in a way that
built trust, never holding a hard position or winning an argument.

## 6. Style rules

- No colon setup lines ("Mercury is at a point few companies reach:").
- No contrast structures ("X instead of Y", "not X but Y", "used to be X,
  now Y", "rather than").
- Never em dashes. No semicolons for effect.
- No filler or stock lines: "I would bring", "I'd bring X to Y",
  "passionate", "excited", "leverage", "opportunity", "the kind of work I
  want to spend my time on", "most companies skip".
- Do not say how much they want the job.
- Do not analyse the company's business, guess at its problems or quote its
  executives.
- Direct but flowing: connected paragraphs with transitions, not choppy
  short sentences. Direct never means skipping the question.
- A story is one to three sentences. Every story ties back to why this role
  or company.
- Nothing on their `banned` list. The save refuses a letter that has one.

## 7. Facts

Use, from their material:

- CPA. Yale SOM MBA. BBA and Master of Accountancy from Baylor, 4.0 GPA.
- About three years at EY, promoted early to Senior. Large public software
  clients: revenue, debt agreements, technical accounting, transactions.
- EY revenue testing tool: they led strategy with the partner and the
  client's data requirements; EY's innovation team built the data pipeline
  and Power BI; it recalculated 100% of recognized revenue; they trained the
  team. SQL was used only a little there.
- First-year SOX 404 for a newly public company: walkthroughs across 10+
  financial reporting processes, process documentation, control design
  recommendations.
- A roughly $10B PE-sponsored take-private and five-plus acquisitions.
- Yale: TA for The Investor, Sourcing and Managing Funds, and The Global
  Macroeconomy; Executive MBA tutor in accounting, entrepreneurial finance
  and modeling. High honors in many individual classes, and Honors in the
  leveraged buyouts course.
- Part-time strategic finance advisor to an early-stage startup: its first
  three-statement model with pricing and unit economics.
- ERPs: NetSuite most; BlackLine on Oracle.
- AI: uses Claude daily for research, analysis and building software;
  built the personal dashboard with coding agents, and it directs agents to
  plan and build its own features against a plan they approve; built an AI
  tool that answers questions from their own notes; treats AI output like
  audit evidence. For economics roles: the interactive IS-LM model.

Never:

- Say they graduated with High Honors from Yale. There is no overall
  distinction, even though one of their older standard lines says so.
- Cite the Still I Rise paper, or feature the Dirty Money card game or
  physical builds.
- Claim a career in private credit, or years they do not have.
- Give the dashboard's URL, step counts or feature lists. Say what it does.
- Contradict the answers already on this application.
- Invent a number, scale, timeline, title, employer, result, thing built or
  view about AI. What comes from the posting is about the role, not a claim
  about them.

## 8. Check, then save

Before saving, read the letter against this list and fix what fails:

- Does the shape match `ai_weight`? For `central`, is AI in the opening and
  in a full paragraph naming what they built?
- Does each paragraph answer something the posting asks for?
- Is every fact in section 7 or the material? Every other line about them
  goes in `unsupported_claims`, verbatim.
- No colon setups, contrasts, em dashes or stock lines; the exact close.

Write the report as JSON in your scratchpad:

```json
{
  "letter": "Dear … Hiring Team:\n\n…\n\nI would welcome the chance to learn more about the role and to discuss how I can contribute to the team.\n\nSincerely,\n\nSelvey Knight",
  "evidence_item_ids": ["<ids from the material the letter draws on>"],
  "unsupported_claims": ["<every line not confirmed by the evidence bank, the transcript or their own words>"],
  "asks": ["<up to four short questions whose answers would make the letter better>"]
}
```

No subject line, date or address block. Ask only what the material and
earlier replies do not answer, such as why this role when nothing says.

```sh
npm run cover-letter -- save <request id> <file>
```

Read the whole output, not a filtered part of it.

- `"ok": true` prints the word count and the asks kept. The request is done.
- `"ok": false` says why: a banned construction, a letter outside 250 to
  420 words, or a report in the wrong shape. Add `--any-length` only when the
  person's comments or replies ask for a different length. Fix it and save again, at most three times. If it still fails, run
  `npm run cover-letter -- fail <request id> "<why, in one sentence>"`.

The letter lands beside the editor. Do not write `applications.cover_letter`
and do not set `has_cover_letter`; the person inserts and saves it.

End with the letter itself, then one line: the role, the AI weight, the word
count, and the lines you flagged.

---
name: learn-drafts
description: Draft the Learn topics waiting in learn.topic_draft_requests, each with its ladder of levels, checks, links and citations, and save them through npm run learn:drafts, which checks each draft and keeps it as the app's own drafting did (approved, put on its lens, linked to the topic that wanted it). The app queues a topic here instead of paying for an API call. Use when the goals routine is fired with a brief that starts "Follow .claude/skills/learn-drafts/SKILL.md" and names "Learn topic drafts", or the user says "draft the waiting Learn topics".
---

# Drafting Learn topics

When the person asks Dash for a Learn topic (on Topics, a subject's page, a
draft's wanted list, a research brief, or a subject's preparation), the app
no longer calls the API: that was about a dollar a topic, and a preparation
drafts forty. It writes a row in `learn.topic_draft_requests` and fires this
routine. You write each draft yourself, from the same prompt the API call
was given, and hand it back through the script, which checks it with the
same parser and does what the press would have done with it.

**You change rows, not code.** Do not commit or push. Do not delete anything.
In anything the person reads (topic names, scopes, checks, link reasons), the
assistant is **Dash**, never "Claude".

## The loop

Work from the repository root. If `node_modules` is empty, run `npm ci` first.

1. `npm run learn:drafts -- status` to see how many wait.
2. `npm run learn:drafts -- next` takes the oldest waiting request and prints
   its `request` (id and goal), `system`, `prompt` and `tool`. When it prints
   `"request": null`, the queue is empty: stop.
3. Read `system` as your instructions and `prompt` as the request, exactly as
   the model would have. Write the draft as the JSON input of `tool`
   (`report_topic`): an object matching `tool.input_schema`. Follow the
   system text closely: the ladder, the ceiling, two to five checks a level,
   links only to topics the prompt lists by their exact name, `missing` for
   topics the map lacks, and a cite on every row the given sources support,
   in the form the prompt asks for. A goal too broad to be one topic gets
   `{"too_vague": true, "name": "", "scope": "", "ceiling": 1, "levels": []}`.
4. Write the JSON to a file in your scratchpad and run
   `npm run learn:drafts -- save <id> <file>`.
   - `"ok": true` prints the kept topic. Go back to step 2.
   - `"ok": false` prints why the draft did not check (a malformed row, a
     link to a name the map lacks, too few checks). Fix that and save again,
     at most twice. If it still fails, or the goal is too vague, run
     `npm run learn:drafts -- fail <id> "<why, in one sentence>"` and go on.
5. When `next` returns null, run `status` once more and end with one line:
   how many you drafted and how many you gave up on.

Draft one request at a time, in the order `next` gives them. A preparation
queues forty or so at once; work through all of them in this session. If the
session is ending before the queue is, stop after a save: a request you took
but did not save is handed out again after an hour.

## Quality

Each draft is the topic as a good textbook index and a practitioner would
both recognise it. The scope is one specific sentence, since duplicates are
found by it. Checks are things a person can be asked to do, not topics to
read. When sources are given, the draft is compiled from them: cite the
source and item for every level, link and missing topic they support, and
leave a row uncited only when nothing given supports it. When a stored
document's weeks are among the sources, prefer what they teach over what
you would have guessed.

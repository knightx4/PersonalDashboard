---
name: bot-pages
description: Make the page a bot on People was asked for (core.dash_handoffs, kind 'page'). Read the hand-off and the thread, gather what bears on it from the person's rows, build one self-contained interactive HTML page (a practice drill, a quiz, a prep sheet) with its own CSS and JS and no outside calls, keep it in core.files as format html, post the link into the same thread as the bot, and close the hand-off; on any failure, mark it failed and tell the thread why. Use when the Dash backup routine is fired with a brief that starts "Follow .claude/skills/bot-pages/SKILL.md" and names "Bot page <id>".
---

# Making a page a bot was asked for

A bot on People (Gert the career manager, any mentor, council member or guest)
was asked for something richer than a text, such as "prepare me something for
my interview tomorrow to practise my accounting". It called `make_page`, which
kept the request in `core.dash_handoffs` with `kind = 'page'`, said "OK, I'm on
it" in the thread, and started this routine (plan #2997; code in
`lib/you/bot-pages.ts`).

The person is waiting in that thread. After 20 minutes the bot tells them it
is still working, and after 90 the hand-off is failed and they are told
(`you.watch_bot_pages`, you migration 0047). So build one good page, post it,
and stop.

**You change rows, not code.** Do not commit or push.

## How you read and write

Through `npx tsx scripts/sql.ts` (CLAUDE.md, "Rows are written through
scripts/sql.ts"), never the Supabase connector. Every read and write names the
`user_id` in your brief. Long text, the page above all, goes through
`--file` with dollar quoting (`$page$ … $page$`), so no quote in it breaks the
statement.

## 1. Read the hand-off and the thread

```sql
select id, status, title, request, asked, context, persona, advisor_id, advisor_chat_id, message_id, created_at
from core.dash_handoffs
where id = '<id>' and user_id = '<user_id>' and kind = 'page';

select role, speaker_id, text, created_at from you.advisor_messages
where chat_id = '<advisor_chat_id>' and user_id = '<user_id>'
order by created_at desc limit 40;

select name, key from you.board_advisors where id = '<advisor_id>' and user_id = '<user_id>';
```

If the row is missing or its status is `done` or `failed`, stop: it has been
handled. Otherwise mark it as being worked on:

```sql
update core.dash_handoffs set status = 'fired', fired_at = coalesce(fired_at, now())
where id = '<id>' and user_id = '<user_id>' and status in ('pending', 'fired');
```

`asked` is the person's own words, `request` and `title` are what the bot
understood, and `context` is what the bot knew: the role, the round and date,
what the job description asks for, with refs. `persona` is the bot's card, so
the page sounds like the person who made it.

## 2. Gather what bears on it

Read the rows the context names by their refs, and look for more where the
request needs it. `lib/<module>/sources.ts` lists each module's tables. For a
career bot such as Gert preparing an interview:

- the role and company: `job_search.applications`, `job_search.roles`,
  `job_search.companies`, with the job description;
- the interview: its round and date (the role's stages, the person's calendar
  notes in the thread);
- the evidence bank: the person's stories and achievements that answer the
  role's asks (`job_search` evidence tables, `lib/jobs/sources.ts`);
- their notes on the role and on prep.

Read only; this skill writes four rows (step 4). Do not spend more than a few
minutes here: the page is the work.

## 3. Build the page

One HTML document, complete on its own:

- **Self-contained.** All CSS in `<style>`, all JS in `<script>`, no `src`
  or `href` to anything outside, no fonts or images from the web (inline SVG
  or a `data:` URI if you need a picture), no `fetch`. It is served under a
  Content-Security-Policy that blocks every outside request
  (`PAGE_VIEW_HEADERS`, `lib/files/files.ts`), so anything outside simply
  does not load.
- **No storage.** It runs in a sandbox with no origin, so `localStorage`,
  cookies and `window.parent` throw. Keep state in variables.
- **Works on a phone.** `<meta name="viewport" content="width=device-width,
  initial-scale=1">`, a single column up to about 40rem, inputs and buttons
  at least 44px tall, a 16px base font. It is shown in a frame on the file's
  page and full screen from a link; it must read in both.
- **Light, plain and calm.** Warm off-white background, dark text, one
  accent colour, generous spacing. Honour `prefers-color-scheme: dark` with
  a dark variant.
- **Under 150,000 characters** (`core.files` takes 200,000).

For a **practice drill**, which is the usual ask:

- a title, one line on what it is for (the role and the date), and how many
  questions;
- 10 to 20 questions across the topics asked for, hardest last. For an
  accounting drill: journal entries, revenue recognition, accruals and
  deferrals, month-end close, reconciliations, and one or two tied to the
  role's own industry;
- each question takes an answer first: a choice to pick, a number or a short
  text to type. Then **Reveal the answer** shows the worked answer: the
  answer, the reasoning step by step, and the entry or the figures laid out;
- the person marks themselves right or wrong after reading it (a typed
  answer is not graded by the page), and a picked choice is marked by the
  page;
- a score at the end, with the topics they missed listed to go back to, and
  a **Start again** that clears the answers;
- the worked answers must be right. Check every figure and every debit and
  credit before you keep the page.

Write the words in the bot's voice where there is voice (the intro line, the
end), and plainly everywhere else. Name no tools or models: the person reads
it as the bot's work, and the app is Dash.

Before keeping it, read it back once as the person would: every button does
something, the reveal works for every question, the score adds up, and
nothing refers to a file or a site it cannot reach.

## 4. Keep it, post it, close it

**Keep the page** in `core.files`, then record it so it shows on Home with
its Undo:

```sql
insert into core.files (user_id, title, summary, body, made_by, origin, format)
values ('<user_id>', '<title>', '<one sentence on what it is>', $page$<!doctype html>…$page$,
        'claude', 'core.dash_handoffs:<id>', 'html')
returning id;

select core.record_dash_action('<user_id>', 'core.files:<file id>', 'insert', 'make_page',
  $s$Dash made the page "<title>" that <bot name> was asked for.$s$);
```

**Post the link** into the same thread as the bot. In a group the message
names the bot as its speaker; in a one-on-one it does not:

```sql
insert into you.advisor_messages (user_id, chat_id, role, kind, speaker_id, text, receipts)
values ('<user_id>', '<advisor_chat_id>', 'advisor', 'reply',
        (select case when c.kind = 'group' then '<advisor_id>'::uuid end
           from you.advisor_chats c where c.id = '<advisor_chat_id>' and c.user_id = '<user_id>'),
        $t$<one or two sentences in the bot's voice: what it made and how to use it>$t$,
        jsonb_build_array(jsonb_build_object('label', '<title>', 'link', '/goals/files/<file id>')))
returning id;
```

The text is the bot speaking, as its persona would text: "Here's your drill:
14 questions on journal entries, accruals and rev rec, hardest last. Answer
each one before you reveal it." No "Claude", and nothing about a routine or
a session. The receipt is the link; the thread shows it under the text.

**Close the hand-off:**

```sql
update core.dash_handoffs
set status = 'done', file_id = '<file id>', finished_at = now()
where id = '<id>' and user_id = '<user_id>';
```

Read the file row and the message back to check they landed.

## When it fails

If anything stops you (a write refused, the page cannot be made from what
there is, the request is not something a page can do), the thread must hear
why. Mark the hand-off failed with the reason in one plain sentence the
person can read, then have the bot say it:

```sql
update core.dash_handoffs
set status = 'failed', error = '<why, in plain words>', finished_at = now()
where id = '<id>' and user_id = '<user_id>';

select you.tell_bot_page('<id>');
```

`you.tell_bot_page` posts "That didn't work, sorry. <why> Ask me again and
I'll have another go." as the bot and sets `told_at`, once. A hand-off is
never left `pending` or `fired` when you stop.

When the request is unclear in a way that changes the page, do not guess:
make the page from the most likely reading, and say in the posted text which
reading you took.

## Report

One line: the hand-off id, the file id, the message id and the final status,
or the reason it failed.

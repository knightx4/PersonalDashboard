---
name: dash-backup
description: Carry out a request Ask Dash handed on because none of its own tools could do it (core.dash_handoffs). Read the hand-off, do what the person asked through scripts/sql.ts (creating and editing their rows, never deleting, sending or spending), write Dash's reply into the same Ask Dash conversation, close the hand-off, and file a note naming the ability Dash lacked. Use when the Dash backup routine is fired with "Hand-off <id>", or the user says "work the Dash hand-offs".
---

# Doing what Ask Dash handed on

**A brief that names `Bot page <id>` is not Ask's.** A bot on People asked this
routine to make a page (plan #2997). Follow `.claude/skills/bot-pages/SKILL.md`
for it instead of this file.

Ask Dash answers questions and makes eight kinds of change itself, with an
Undo: adding a todo, a goal or a goal step, renaming, moving or ticking off a
todo, closing a goal step, marking an item returned, and adding a note on a
role (`lib/dash/writes.ts`). It can also propose a price watch for the person
to confirm. When the person asks for anything else ("add a course to Learn"),
Dash calls `hand_off`. That keeps the request in
`core.dash_handoffs`, tells the person it has been passed on, and starts this
routine. Code: `lib/talk/handoff.ts`, `lib/dash/ask.ts`.

A request for an X post draft is not handed on: Dash saves it itself with
`suggest_post` (`lib/dash/post-writes.ts`), and `handoffRequest` refuses one.
If a hand-off for a post is open anyway, write the draft the way the posts
skill does (`.claude/skills/posts/SKILL.md`) and say so in your reply.

The person is watching the thread. It checks for your reply every twenty
seconds for half an hour, so be quick: do the one thing they asked, reply, and
stop.

**You change rows, not code.** Do not commit or push. The note you file at the
end is how the code catches up.

## How you read and write

Through `npx tsx scripts/sql.ts` (CLAUDE.md, "Rows are written through scripts/sql.ts"), not the Supabase connector, whose confirmations never reach
a routine. It refuses deletes, which this skill never makes anyway. Filter every read and every write
by the `user_id` in your brief. You are writing as the service role, so row
level security does not stop you touching another account's rows; the filter
is the only thing that does.

## 1. Read the hand-off

Your brief names it: `Hand-off <id>`, `user_id <uuid>`, `conversation <uuid>`,
then the request. Read the row and the conversation so far:

```sql
select id, request, status, conversation_id, turn_id
from core.dash_handoffs where id = '<id>' and user_id = '<user_id>' and kind = 'request';

select role, body, citations, created_at from core.conversation_turns
where conversation_id = '<conversation>' and user_id = '<user_id>'
order by created_at;
```

If the row is not there, or its status is `done` or `failed`, stop: it has been
handled. If its `kind` is `session`, or the brief's second line is `kind
session`, follow **A session hand-off** below instead of the steps here. With
no id in the brief, work every row for that user whose `kind` is `request` and
whose status is `pending` or `fired`, oldest first. A row of kind `page` is a
bot's page, and goes by `.claude/skills/bot-pages/SKILL.md`. Rows of kind
`page` and `session` are left alone there: each is started with its own id.

## 2. Decide whether you may do it

You may **create** rows and **edit** rows the person owns, when they asked for
it by name: a goal, a todo, a job application, a note, a course, a step.

You may not, however it is worded:

- delete or archive anything, or mark something dropped;
- send an email or a message, submit a form, or post anywhere outside the app;
- buy, pay or spend anything;
- approve, answer or dismiss something on the dev pages, which are the
  person's moves.

For those, skip to step 4 and reply saying it is theirs to do on the page,
naming the page. The same goes for a request that is really a feature to build
("make Dash able to …"): file it as a note (step 5) and reply saying so.

When the request is unclear in a way that changes what you would write, do not
guess. Reply with the one question you need answered, and close the hand-off as
`done`; their answer arrives as a new question to Dash.

## 3. Do it

Find the table before writing. `lib/<module>/sources.ts` lists each module's
tables, and the page's own server action (`app/<module>/**/actions.ts`) shows
the columns a new row needs and the checks it passes. Write the row the way that
action would.

Where a workspace has its own skill, its rules for writing apply to you too:

- **Goals** (`goals.items` and the rest): read `.claude/skills/goals/SKILL.md`,
  "How you read and write" and "The run row". Write a `goals.runs` row with job
  `goal` first, and put `set local goals.actor = 'claude'` and the run id at the
  top of every call that writes. A goal the person asked for is approved by
  their asking. Give it a done-when and a first step; leave mapping the whole
  path to the goals routine, which the goal's page can start.
- **The dev pages** (ideas, plan, notes): `.claude/skills/plan/SKILL.md`.

Then read the row back to check it landed.

**Record each write** with `core.record_dash_action`, so it shows on Home
under what Dash did today, with an Undo. One call per row you added or
changed; the reply turn, the note and the hand-off are not recorded.

```sql
-- an insert: once it has returned the id, in the next call. The function
-- reads the new row itself.
select core.record_dash_action('<user_id>', 'goals.items:<id>', 'insert', 'add_goal',
  $s$Dash added the goal "Make a new song and publish it on Spotify" under Music.$s$);

-- an update: keep the row as it is, write, then record, all in one call
select core.dash_before('todo.tasks:<id>');
update todo.tasks set due_on = '2026-10-09' where id = '<id>' and user_id = '<user_id>';
select core.record_dash_action('<user_id>', 'todo.tasks:<id>', 'update', 'move_todo',
  $s$Dash moved "Call the dentist" to 9 October.$s$);
```

The arguments are the account, the row as `schema.table:id`, the op
(`insert` or `update`), what was done in snake_case, and one finished
sentence the person reads as it is: it names Dash, says what changed and on
which row, and stays under 300 characters. The surface defaults to
`routine`, which is right. If the call fails, everything in that call is
rolled back, the write included, so read the message, fix it and send both
again.

## 4. Reply in the conversation

Write one assistant turn. It is Dash speaking, so it says "I", never "Claude".
Say what you did, where it is, and how to put it back if they do not want it:

```sql
insert into core.conversation_turns (conversation_id, user_id, role, body, citations)
values ('<conversation>', '<user_id>', 'assistant',
  $b$Done: I added the goal "Make a new song and publish it on Spotify" under Music, with a first step to write the lyrics. You can rename or drop it on its page.$b$,
  '[{"table": "goals.items", "ref": "<id>", "title": "Make a new song and publish it on Spotify", "href": "/goals/<id>"}]'::jsonb)
returning id;
```

`citations` links what you wrote, so the person can open it from the reply.
Each entry needs `table`, `ref`, `title` and an `href` that is a path in the
app; leave the column null when there is nothing to link. Keep the body to a
few sentences and under 8000 characters.

Reply in words every time. A hand-off is a request, and a request carried out
is reported, so the seen mark (`core.acknowledge_thread_turn`) is not for this
routine. Where a hand-off turns out to be only a thanks or a status update with
nothing to do, a one-sentence reply is enough.

## 5. File the note

Every hand-off files one note, so the ability is added to Dash itself and the
next request like this one does not need you:

```sql
insert into public.feedback_items (user_id, kind, body, page_path)
values ('<user_id>', 'feature',
  $n$Ask Dash could not <what it was asked, in general terms: create a goal>, so it handed the request to the backup routine (hand-off <id>). Give Dash a write tool for it in lib/dash/writes.ts.$n$,
  '/ask/<conversation>')
returning id;
```

First check for an open note asking for the same ability, and reuse its id
rather than filing another:

```sql
select id, body from public.feedback_items
where user_id = '<user_id>' and status = 'open' and body like 'Ask Dash could not%';
```

## 6. Close the hand-off

```sql
update core.dash_handoffs
set status = 'done', reply_turn_id = '<the turn id>', note_id = '<the note id>',
    finished_at = now()
where id = '<id>' and user_id = '<user_id>';
```

If something stopped you from finishing (a write refused, a table you could not
find), still write a reply saying what went wrong in a sentence, then set
`status = 'failed'` and `error` to the reason. A hand-off is never left
`fired`: the thread keeps waiting on it.

## A session hand-off

A brief that opens `Hand-off <id>` and then `kind session` comes from a bot
handing on work too big for a chat turn (plan #3005): Ask Dash, or a bot on
People such as Gert, Zena, Jerwyn, Maya or the builder, in a one-on-one or a
group chat. The work is usually long writing (a plan step with its full
detail, a vault note, a prep doc, a cover letter), research, or changes across
many rows. The bot has already told the person it is on it. The app started
this run (`lib/talk/handoff-fire.ts`) and moved the row to running.

The rules in step 2 hold as they are: create and edit their rows, never
delete, send or spend, and change rows, not code. What differs:

**Read the row, the thread and the refs.**

```sql
select id, kind, advisor_id, conversation_id, advisor_chat_id, request, asked,
       summary, refs, subject_ref, state
from core.dash_handoffs where id = '<id>' and user_id = '<user_id>' and kind = 'session';

-- Ask Dash (conversation_id set): the conversation, as in step 1.
-- A People chat (advisor_chat_id set): the last of it, and who the bot is.
select role, speaker_id, text, created_at from you.advisor_messages
where chat_id = '<advisor_chat_id>' and user_id = '<user_id>'
order by created_at desc limit 40;
select name from you.board_advisors where id = '<advisor_id>' and user_id = '<user_id>';
```

`asked` is the person's request in their own words and is what you are held
to; `request` is the bot's version of it. Read every row in `refs` before you
start: the bot named them because the work needs them.

**Say you are at work.** Run this first, and again after each long stretch,
about every ten minutes. It keeps `last_seen_at`, which is how a session gone
quiet is noticed:

```sh
npx tsx scripts/handoff-session.ts seen <id>
```

**A brief with a `browser task` line** (its third line, after `kind
session`) needs a web browser: read **A browser task** below before you
start, and record the route it gives before you close.

**Do all of it.** You have the room the chat turn did not, so finish the
work rather than a first part of it. A plan step goes through
`scripts/plan.ts` and the plan skill's rules, a goal through the goals
skill's. Record each row you write with `core.record_dash_action`, as step 3
says. No note is filed: a session hand-off is the bot using a session as
meant, not a gap in its tools.

**Reply in the thread.** The person is waiting there, and the close below
refuses a done that leaves them without the result.

- **An Ask Dash conversation** (`conversation_id` set): write the reply as
  step 4 says, with what you did, a citation linking each row, and how to
  put it back. Keep its turn id for `--reply-turn`.
- **A People chat** (`advisor_chat_id` set, one-on-one or group): the bot
  posts the result, so give `close` the text in the bot's voice, as its
  persona would text it: what you did, in a sentence or two, with no
  "Claude", no session and no routine. Each row you made or changed goes in
  as `--link "<label>=<path in the app>"`, which the thread shows under the
  text. Add `--undo` when you recorded any change with
  `core.record_dash_action`: it adds a link to Home, where each one has its
  Undo. In a group the message is posted with the bot as its speaker.

**Close it through the script, never with an update.** Closing counts the
session's cost toward spend: one `core.model_spend` row per model under
`core / hand-off-session`, read from this session's transcripts, and the
total on `cost_micros`. It also tells the thread. An update through
`scripts/sql.ts` would skip both.

```sh
npx tsx scripts/handoff-session.ts close <id> --done --reply-turn <turn id>
npx tsx scripts/handoff-session.ts close <id> --done \
  --reply "Done. Your 10k goal is up, with a plan for the eight weeks to race day." \
  --link "Run a 10k=/goals/<goal id>" --undo
npx tsx scripts/handoff-session.ts close <id> --failed "The vault note was refused: its folder does not exist."
```

A failure is told in the thread for you: "That didn't work, sorry. <your
reason> Ask me again and I'll have another go." So write the reason as one
plain sentence on what stopped you, read by the person. In an Ask Dash
conversation you may write your own reply turn first and pass `--reply-turn`
with `--failed`; then nothing more is posted. Run `close` as the last thing
you do, so the cost it counts is the whole session's. A session hand-off is
never left running, whatever happened.

If you go quiet, the thread hears it anyway (`you.watch_bot_pages`, every two
minutes): 20 minutes with no `seen` posts that it is taking longer than it
should, and 90 fails the hand-off and says so. One closed done with nothing
posted is reported after 10 minutes with a link to Home.

## A browser task

The bot marked the hand-off as needing a real browser (`browser_task`, plan
#3040): clicking through a site, filling in a form, or reading a page that
needs the person signed in. There are two browsers, and you pick one before
you open any page. docs/HANDOFF-BROWSER.md says where these sessions run.

**1. Is Claude in Chrome here?** It is when your tools include
`mcp__claude-in-chrome__*`, or an `enable__mcp__claude-in-chrome` tool that
turns them on. Load them with ToolSearch (`select:` and the names, in one
call) and read `anthropic-skills:chrome-browser` before the first step.
Then check it answers: list the tabs. If it lists them, Chrome is open with
the extension connected, and it is your browser. It has the person's own
sign-ins, so work in a new tab and leave their open tabs alone.

A cloud session never has these tools: the person's Chrome is on their own
computer, and only a session started there by the runner on their PC or Mac
can reach it (plan #3040.5 and #3040.6). Nothing is wrong when they are
missing, and there is nothing to retry. What the person needs to hear is why
no runner took the task, so read it once:

```sh
npx tsx scripts/handoff-session.ts runners
```

It prints each computer's last heartbeat and a `sentence` such as "The
browser runner has never run on your PC or your Mac…" or "…it was last seen
on your PC 3 hours ago". Wherever this section has you say you could not
reach their Chrome (the route's `--reason`, a `--failed` reason, the reply),
say that sentence instead of "I couldn't reach your Chrome" alone (plan
#3075).

**2. Without Chrome, a headless browser on public pages.** The session has a
headless Chromium, the one Playwright installs, with no paid browser service
behind it. Read a page with

```sh
npx tsx scripts/browse.ts <url>
npx tsx scripts/browse.ts <url> --eval "document.querySelector('a.next').click()" --eval "document.title" --shot /tmp/page.png
```

which prints the address it ended on, the title, the page's text, each
`--eval`'s value and `signInWall`. Each call starts a fresh browser, so for
a longer path through a site, write a short script in your scratchpad on
`launch()` from `tests/interaction/browser.ts` and drive that one page. The
headless browser has none of the person's sign-ins and keeps nothing between
runs.

**3. A sign-in with no Chrome: stop.** When the page needs the person signed
in (`signInWall` is true, or the page says so) and Chrome is not here, do
not try to sign in, and never ask for or type a password. Record route
`none`, then close `--failed` with the reason in a sentence the person can
act on: "That page needs you signed in, and the browser runner has never run
on your PC or your Mac, so start it on your PC first (npm run browser-runner
-- pc --install)." with the runner's sentence from `runners` in place of the
middle. The thread adds "Ask me
again" after it. A request whose
whole point is behind a sign-in (their bank, their orders) is this case from
the start: you need not open it headless first.

**Record the route before you close.** Once you know which browser did the
work, or that neither could:

```sh
npx tsx scripts/handoff-session.ts browser <id> --route chrome --reason "Your Chrome was open with Claude in Chrome connected."
npx tsx scripts/handoff-session.ts browser <id> --route headless --reason "Your Chrome wasn't reachable, and the page is public."
npx tsx scripts/handoff-session.ts browser <id> --route none --reason "The page needs you signed in, and your Chrome wasn't reachable."
```

It writes `browser` (chrome, headless, or null for `none`) and
`browser_reason` on the row. Run it again if the route changes partway, for
instance when a headless run hits a sign-in. `close --done` refuses a browser
task with no route recorded.

**Name the route in the reply.** Say which browser did it, in the person's
words: "I checked it in your Chrome" or "Your Chrome wasn't open, so I read
the public page in a browser with none of your sign-ins". The People reply
and the Ask reply turn both carry it.

**Nothing is bought, sent or submitted.** Step 2 holds in either browser.
A purchase, a message sent, or a form submitted (a sign-up, a booking, an
application, a contact form) is the person's to press. Stop at the last
step before it: fill in what you can in Chrome, then close the hand-off
done with a reply that says what is ready, where, and that the press is
theirs. Their request does not count as a yes, and neither does a yes later
in the thread. Search boxes, filters and "next page" links are not
submissions. No password, card number or one-time code goes into a row, a
note, a reply or a file.

## Report

One line per hand-off: its id, what you did, the note id, and its final status.

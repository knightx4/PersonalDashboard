---
name: dash-backup
description: Carry out a request Ask Dash handed on because none of its own tools could do it (core.dash_handoffs). Read the hand-off, do what the person asked through the Supabase connector (creating and editing their rows, never deleting, sending or spending), write Dash's reply into the same Ask Dash conversation, close the hand-off, and file a note naming the ability Dash lacked. Use when the Dash backup routine is fired with "Hand-off <id>", or the user says "work the Dash hand-offs".
---

# Doing what Ask Dash handed on

Ask Dash answers questions and can propose four changes: a todo, a goal step,
marking an item returned and a price watch. When the person asks for anything
else ("add a goal to publish a song on Spotify"), Dash calls `hand_off`. That
keeps the request in `core.dash_handoffs`, tells the person it has been passed
on, and starts this routine. Code: `lib/talk/handoff.ts`, `lib/dash/ask.ts`.

The person is watching the thread. It checks for your reply every twenty
seconds for half an hour, so be quick: do the one thing they asked, reply, and
stop.

**You change rows, not code.** Do not commit or push. The note you file at the
end is how the code catches up.

## How you read and write

Through the **Supabase** connector (`mcp__Supabase__execute_sql`, loaded with
ToolSearch), project `asjztutnqxbecruvyrbj`. Filter every read and every write
by the `user_id` in your brief. You are writing as the service role, so row
level security does not stop you touching another account's rows; the filter
is the only thing that does.

## 1. Read the hand-off

Your brief names it: `Hand-off <id>`, `user_id <uuid>`, `conversation <uuid>`,
then the request. Read the row and the conversation so far:

```sql
select id, request, status, conversation_id, turn_id
from core.dash_handoffs where id = '<id>' and user_id = '<user_id>';

select role, body, citations, created_at from core.conversation_turns
where conversation_id = '<conversation>' and user_id = '<user_id>'
order by created_at;
```

If the row is not there, or its status is `done` or `failed`, stop: it has been
handled. With no id in the brief, work every row for that user whose status is
`pending` or `fired`, oldest first.

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

## 5. File the note

Every hand-off files one note, so the ability is added to Dash itself and the
next request like this one does not need you:

```sql
insert into public.feedback_items (user_id, kind, body, page_path)
values ('<user_id>', 'feature',
  $n$Ask Dash could not <what it was asked, in general terms: create a goal>, so it handed the request to the backup routine (hand-off <id>). Give Dash a proposal for it in lib/ask/propose.ts.$n$,
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

## Report

One line per hand-off: its id, what you did, the note id, and its final status.

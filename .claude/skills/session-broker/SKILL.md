---
name: session-broker
description: Pass what the person wrote in Chat's session threads (core.session_threads and core.session_messages) to each thread's Claude Code session. On every wake, list the threads with something waiting through npm run broker, start a session on the right repository for a thread that has none (create_session, Opus, the prompt the script prints), pass the rest to the thread's session with send_message, replace a session that has ended, mark what was passed as delivered, and set idle the threads whose session has stopped. Use when the broker's wake-up task fires with "A message is waiting in session thread <id>", or the user says "run the session broker".
---

# The session broker

You are the standing broker session for Chat's session threads (plan #2789).
The person writes in a thread in the app; the app saves the row and fires
your wake-up task with "A message is waiting in session thread <id>". You
hand what they wrote to the thread's own session, which works on the
thread's repository and replies into the thread through the Dash connector.
You never reply in a thread yourself and never do a thread's work: you only
start sessions and pass messages.

Only a session started with `create_session` has the session tools
(`create_session`, `send_message`, `get_session`, `list_events`), which is
why this is a standing session and not a routine. If those tools are not
loaded, load them with ToolSearch; if they are not there at all, say so in
one line and stop.

## Each wake

Work from this repository's checkout. Pull main first (`git fetch origin
main && git reset --hard origin/main`; this session commits nothing), and run
`npm ci` if node_modules is empty.

The thread named in the wake text is only the reason you were woken. Work
every thread that has something waiting, since a wake can be missed or two
messages can share one.

### 1. What is waiting

```sh
npm run -s broker -- pending
```

It prints `{ "jobs": [...] }`, one job per thread with something waiting,
oldest first. A job is waiting rows of two kinds: a message the person wrote
that the session has not been given, and an answer they pressed on one of
the session's questions. Each job carries:

| field | what it is |
|---|---|
| `thread_id`, `title`, `state` | the thread |
| `action` | `start`: the thread has no session yet. `send`: pass `message` to `session_id`. |
| `session_id` | the thread's session, on a `send` |
| `source_url`, `session_title`, `model` | what `create_session` takes |
| `prompt` | the whole prompt for a new session: the rules of the thread and the thread so far |
| `message` | the turn for `send_message`: what is waiting, quoted |
| `deliver` | the ids of the rows this job passes on |

Use the texts exactly as printed. The thread session's rules live in
`threadSessionPrompt` in `lib/threads/broker-model.ts`; a change to them is
made there, not by rewording a prompt on the way through.

An empty list means nothing is waiting. Go to step 3.

### 2. Pass each job on

For a `start` job, call `create_session` with `source_url`, `title` set to
`session_title`, `model`, and `prompt`. Then, at once:

```sh
npm run -s broker -- delivered <thread_id> --ids <deliver, comma-separated> --session <the new session's id>
```

That keeps the session's id on the thread, so the next message goes to the
same session, marks the rows delivered and puts the thread to working.

For a `send` job, call `send_message` to `session_id` with `message`. A
session whose container was reclaimed is woken by the message itself, so
send even when `get_session` says it is idle. Then:

```sh
npm run -s broker -- delivered <thread_id> --ids <deliver, comma-separated>
```

When `send_message` fails because the session has ended, was archived or
cannot be found, start a replacement: `create_session` with the job's
`prompt` (it already holds the thread so far, and says an earlier session
ended), then `delivered` with `--session <the new id>`, which replaces the
old id on the thread. Any other failure: leave the rows undelivered, so the
next wake tries again, and say which thread failed and why in your final
line.

Mark a job delivered only after its `create_session` or `send_message`
succeeded. Never mark rows you did not pass on.

### 3. Threads whose session has stopped

```sh
npm run -s broker -- watching
```

lists the threads in `working` or `waiting` with their `session_id`. For
each `working` one, call `get_session`. When the session has stopped
(idle, ended or archived), run `npm run -s broker -- idle <thread_id>`, so the
thread no longer shows a session at work. Leave `waiting` threads as they
are: they wait on the person's answer, and their session is meant to be
stopped.

### 4. End the turn

One line: how many sessions you started, how many messages you passed on,
and any thread that failed. Then stop and wait for the next wake. Do not look
for other work.

## What you never do

- Write into a thread, answer the person, or change a thread's title.
- Read or change rows outside `core.session_threads` and
  `core.session_messages`, or any account but the owner's (the script scopes
  every query to them).
- Start a second session for a thread whose session still exists. A new
  session is only for a thread with none, or one whose session has ended.
- Pass on a trial thread of the wake-time measurement ("Wake test …"). The
  script leaves them out; its own wake text says what to do with one.

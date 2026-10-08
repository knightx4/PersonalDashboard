# A comment addressed to you

A comment on a step, an idea or a raise with `@dash` in it is addressed to you,
and it is one of two things: a question about the row, or an instruction to do
something to it. Most are handled in seconds by a direct model call, which has
the row and the thread and nothing else; when that call says it needs the code,
it starts a session with the row, what was written, and where the reply goes.
That session is you, and the turn says which of the two it was handed.

**A question is answered, and only answered.** Read what it is about, write one
comment into the thread (the `core.add_thread_turn` call in `offline.md`), and stop. Do not answer a
decision, do not change a status, a detail or a done-when, do not shape the idea,
do not close or dismiss the raise, and do not commit. The person asked what
something means; a session that answers by settling it has taken the decision
away from them, which is the same rule as never answering your own decision.

If the answer is that the thing being asked about is wrong, say that in the
thread. Then it is theirs to act on — a note, a decision, or nothing.

**An instruction is carried out, and then reported.** Doing it and saying so is
what #359 settled, so do not write back what you would do and wait to be told
again. Three things are yours to do:

- File an idea on the ideas page, the same as `plan.ts idea "…"` — it lands as
  a suggestion, under the person's own.
- Reword the row it was written on: an idea's text, or a step's title, detail
  or done-when. Put the old wording into the thread with the new, which is what
  makes it reversible by hand.
- Hand a plan step over to be built, through the same checks the page's own
  button makes.

Everything else is theirs, made on the page: never approve a proposal, never
answer a decision, never set a status or an assignee by hand, and never dismiss
or delete anything. Asked for one of those, change nothing and say in the thread
that it was not done and why. Do not commit either way — these are rows, not
code.

## A comment that needs no answer

A tagged comment that asks nothing and wants nothing done (a status update,
thanks, "looks good") does not need a written reply. Answer it with the seen
mark, which shows beside the comment as "Seen by Dash", or with one sentence.
The turn id is on `core.thread_turns` for the ref:

```sql
select id, author, body from core.thread_turns where ref = 'public.plan_items:<the step>' order by created_at;
select core.acknowledge_thread_turn('…', 'public.plan_items:<the step>', '<turn id>');
```

The mark is only for a comment you have changed nothing for. The database
does not stop you marking after a change, so keep the rule yourself: a
question gets its full reply, an instruction is carried out and reported in
words, and anything you did in this session, however small, is written into
the thread, never marked. The same limits as the in-app Dash
(`THREAD_RULES` in `lib/dash/thread.ts`):

- "pushed the fix, all good now": mark it seen.
- "thanks, that's what I needed": mark it seen, or reply "Glad it helped."
- "looks good": mark it seen.
- "looks good, can you reword the done-when?": reword it, then reply saying so.
- "done with this one?": reply; it is a question.
- "fixed it, but is the old row still there?": reply to the question.


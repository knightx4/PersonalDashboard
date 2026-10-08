# When the CLI cannot run

`DATABASE_URL` is not set in Claude Code on the web, so `scripts/plan.ts`
exits immediately there. Fall back to the **`Supabase`** connector against
`plan_items` and `plan_dependencies` (both in `public`; project ref
`asjztutnqxbecruvyrbj`), and do not spend the session diagnosing it. The
brief a routine was fired with is the plan as it stood; trust it, and re-read
the row before closing it.

**Keep each write short and plain.** The connector holds some statements for
a confirmation, and in a routine nobody is there to give it, so the call sits
for 60 seconds and times out without running. Which ones it holds depends on
the text: on 1 October 2026 every close whose note mentioned "dropped",
"unique index", "migration" or a refusal stalled, and the same update in
plainer words went straight through. So:

- Write the status and the commit in one statement, and the note in a second.
- Dollar-quote the note (`$n$…$n$`) and say what the step does for the
  person, not how the schema changed. The commit already holds that.
- Avoid `drop` in a migration applied through the connector where another
  form will do.
- After a timeout, select the row to see whether the write landed before
  sending it again. A timeout means it did not run, not that it ran slowly.

The reading rules are in `lib/plan/tree.ts` and are what the page uses; when
working by hand, apply the same ones:

```sql
-- the open steps, in reading order. Rows whose module is a project in
-- lib/plan/projects.ts ('website') are built from that project's own
-- repository by its own routine, never from this one: leave them out.
select number, parent_id, title, status, priority, size, assignee, acceptance, comment
from plan_items
where user_id = '…' and status not in ('done', 'dropped')
  and module is distinct from 'website'
order by module nulls last, position, created_at;

-- what a step waits on
select d.depends_on_id, p.number, p.title, p.status
from plan_dependencies d join plan_items p on p.id = d.depends_on_id
where d.item_id = '…';

-- the visions, when shaping: one row per workspace that has one, keyed by
-- workspace id, and the app's under 'app'. The feature's detail opens with
-- the part of its workspace's vision it serves.
select module, body from module_visions where user_id = '…';

-- a proposal, when shaping (steps beneath: same, with parent_id set)
insert into plan_items (user_id, module, title, detail, acceptance, size, status, position)
values ('…', 'shopping', '…', '…', '…', 'l', 'proposed', 10)
returning id, number;
update ideas set plan_item_id = '<the feature id>' where id = '<the idea id>';

-- a decision, when shaping: the question, its options, your recommendation.
-- Fog goes in the `fog` column of the feature the same insert creates.
insert into plan_items (user_id, module, parent_id, title, detail, kind, status, position)
values ('…', 'shopping', '<the feature id>', '…?', '…', 'decision', 'proposed', 20);

-- add, when building or re-shaping: a step under a feature. Approval stops
-- at the feature, so the status follows the chain above the new row. Read it
-- first: a 'proposed' anywhere in it means the step is proposed too.
with recursive chain as (
  select id, parent_id, status from plan_items
  where id = '<the parent id>' and user_id = '…'
  union all
  select p.id, p.parent_id, p.status from plan_items p
  join chain on p.id = chain.parent_id
  where p.user_id = '…'
)
select bool_or(status = 'proposed') as proposed from chain;
-- Nothing proposed above, and the step stays inside the repository: write it
-- not_started, stamped on its own line with the session that added it (the
-- `cse_…` id in CLAUDE_CODE_REMOTE_SESSION_ID; 'Added by a session on
-- <date>.' when there is none). This is what `add` writes and what
-- lib/plan/origin.ts reads back for the page's drop, so keep the wording
-- exactly. A re-shape puts its 'From #63''s answer: …' line first and this
-- one beneath it. A proposed chain, or a step that would act outside the
-- repository (what `--proposed` is for; building.md, 'Steps that act
-- outside the repository'): status 'proposed', and no stamp.
insert into plan_items (user_id, module, parent_id, title, acceptance, size,
                        status, position, comment)
values ('…', 'dev', '<the parent id>', '…', '…', 's', 'not_started', 30,
        'Added by session cse_… on <YYYY-MM-DD>.')
returning id, number;

-- needs: something only the person can supply, written as a job of theirs
-- rather than as a block on the step that ran into it. Two writes, and both
-- are the command `needs "…" --for <n>`: the setup row under the parent of the
-- stopped step (that step itself when it has no parent), and the dependency
-- from the stopped step to it. Title is the one-line summary, detail is what
-- to actually go and do. Always `me`, never proposed, never claude. Closing it
-- is the person's move -- they press "I have set this up" -- and it carries no
-- commit.
insert into plan_items (user_id, module, parent_id, title, detail, kind, priority,
                        assignee, status, position)
values ('…', 'dev', '<the parent of the stopped step>', 'Set … in …', '…', 'setup', 2,
        'me', 'not_started', 40)
returning id, number;
insert into plan_dependencies (user_id, item_id, depends_on_id)
values ('…', '<the stopped step>', '<the setup step>');
-- and a step blocked on this very thing is not blocked any more: the
-- dependency now says what it waits for.
update plan_items set status = 'not_started', block_ask = null, block_kind = null
where id = '<the stopped step>';

-- start (never on a proposed step, never on a decision, never on a setup step)
update plan_items set status = 'in_progress' where id = '…';

-- done (after committing, so HEAD is the commit that did it). First, for a
-- step that changed a screen: `npm run ui-guard -- <n> --commit <sha>` names
-- the gallery surfaces its files serve and prints a select to run here. Each
-- row it returns is a surface whose latest design check is not a pass, and
-- the step does not close while there is one: say which, and send it back to
-- the critic (plan #1534; the CLI's `done` refuses the same).
update plan_items
set status = 'done', commit_sha = '…',
    comment = coalesce(comment || E'\n\n', '') || 'Done <date>: …'
where id = '…';

-- update: Dash's update on a feature, at the end of a build or re-shape run
-- (plan #1666; SKILL.md, Building step 7). The counts are the feature's steps
-- and substeps, decisions, setup jobs and dropped steps left out: done now,
-- done when its last update was written (or a day ago, for its first), and
-- the total. lib/plan/updates.ts `updateCounts` is the rule; this is it in SQL.
with recursive beneath as (
  select id, kind, status, completed_at from plan_items
  where parent_id = '<the feature id>' and user_id = '…'
  union all
  select p.id, p.kind, p.status, p.completed_at from plan_items p
  join beneath b on p.parent_id = b.id where p.user_id = '…'
), since as (
  select coalesce(max(created_at), now() - interval '1 day') as at
  from plan_updates where feature_id = '<the feature id>' and user_id = '…'
), counted as (
  select * from beneath where kind = 'build' and status <> 'dropped'
)
insert into plan_updates (user_id, feature_id, health, body, steps_done_before,
                          steps_done_after, steps_total, session)
select '…', '<the feature id>', 'on_track', $u$<two or three sentences>$u$,
  (select count(*) from counted, since where status = 'done' and completed_at <= since.at),
  (select count(*) from counted where status = 'done'),
  (select count(*) from counted),
  'cse_…';

-- answer: the person's move, never a session's. Here to be recognised, not run.
update plan_items
set status = 'done', resolution = '<their words>', commit_sha = null,
    comment = coalesce(comment || E'\n\n', '') || 'Answered <date>: …'
where id = '…';

-- fog: write it, or clear it once the steps that dispel it exist. Not a
-- status change, so no dated line goes in the comment. Writing a new patch
-- clears any dismissal on the old one, which is the person's, not yours.
update plan_items set fog = '…', fog_dismissed_at = null where id = '…';

-- dismissed: put aside as not right now. Here to be read, never written.
-- `dismissed_at` is the row itself -- a question they are not answering --
-- and `fog_dismissed_at` is the patch of fog on it; `ideas.dismissed_at` is
-- a suggestion they are not taking. Leave every one of them out of what you
-- read the plan for, and never write one back in another form.
select number, title, dismissed_at, fog_dismissed_at from plan_items
where user_id = '…' and (dismissed_at is not null or fog_dismissed_at is not null);

-- a row a re-shape wrote, stamped with the answer that produced it. The same
-- line `add --from` writes, and what the page and the brief read back; keep
-- the wording exactly, including the apostrophe, or it stops being found.
insert into plan_items (user_id, module, parent_id, title, acceptance, size,
                        status, position, comment)
values ('…', 'dev', '<the feature id>', '…', '…', 's', 'proposed', 30,
        'From #63''s answer: <that answer, first line>');

-- block: not finished, so no commit. `block_ask` is the one sentence saying
-- what it needs, rewritten on every block and read by Dash and the plan row;
-- the dated line is the history and is appended. Clear `block_ask` whenever
-- the step stops being blocked -- start, reopen, done and drop all do.
-- `block_kind` says who clears it and the database refuses a blocked row
-- without one: 'steps' when the block is waiting on the steps it names, which
-- clears itself when they close, and 'outside' when it is waiting for the
-- person to answer or decide something. A key or an account is not a block at
-- all now; it is a setup step, above. Use 'steps' only with the
-- dependency rows to match; 'outside' otherwise. Cleared with the ask.
-- Never write a block whose ask says nothing is needed from the person
-- ("nothing needed from you", "just waiting on the run"): a block is listed
-- under what they have to do. A step that only waits on time or a scheduled
-- run stays in progress and gets a check_backs row instead, so it shows as
-- waiting on:
--   insert into check_backs (user_id, title, detail, due_at, plan_item_id, source)
--   values ('…', '<what to look at>', '<what to check>', now() + interval '2 hours',
--           '<the step id>', 'plan #<n>');
update plan_items
set status = 'blocked', block_ask = '<what it needs, in one sentence>',
    block_kind = 'outside',
    comment = coalesce(comment || E'\n\n', '') || 'Blocked <date>: <the question>'
where id = '…';

-- raise: what you need from the person, when it belongs to no step. `source`
-- says which run raised it and what it was doing; `module` is null for the app
-- as a whole. Never answer or dismiss one -- that is the person's move on
-- /dev/inbox, the same as a decision.
-- `ask` is the move you want back, in one sentence answerable in one line;
-- the CLI refuses a raise without one and doing the insert by hand does not
-- make it optional.
-- `consequence` is what a yes does, in the shape lib/comments/act.ts carries
-- out: {"name": "file_idea" | "file_note" | "add_step" | "build_step" |
-- "send_step" | "reword", "text": "…", "module": "…" | null, "field": null}.
-- `add_step` leaves a proposal, `build_step` writes the step ready to be
-- worked and puts a session on it in the same press, `send_step` takes a
-- step already on the plan, named by number in "text" as "#342". The CLI
-- refuses a raise without one and doing the insert by hand does not make it
-- optional either.
insert into raised_items (user_id, module, title, detail, ask, consequence, source, status)
values ('…', 'dev', '…', '…', '…', '{"name": "file_idea", "text": "…"}'::jsonb,
        'plan #<n>', 'open')
returning id;

-- what is outstanding in both directions: what the person has not answered,
-- and what they answered that no session has replied to. Read at the start of
-- a run.
select r.id, r.title, r.detail, r.ask, r.consequence, r.module, r.source, r.status,
       r.created_at,
       (
         select json_agg(json_build_object('author', c.author, 'body', c.body)
                         order by c.created_at)
         from core.thread_turns c
         where c.ref = 'public.raised_items:' || r.id and c.user_id = r.user_id
       ) as comments
from raised_items r
where r.user_id = '…' and r.status in ('open', 'answered')
order by r.created_at desc;

-- replying to an answer, which is how a raise takes a second round. Every
-- thread is kept in core.conversations under the row's ref (plan #1470), and
-- core.add_thread_turn writes a turn into it, starting the thread if needed.
select core.add_thread_turn('…', 'public.raised_items:<the raise>', 'claude', $c$…$c$);

-- answering a question asked on a row. The same call, and the ref says what
-- the question was about: `public.plan_items:<id>` a step or a decision,
-- `public.ideas:<id>` an idea, `public.raised_items:<id>` a raise. Read a
-- thread from core.thread_turns by the same ref.
select core.add_thread_turn('…', 'public.plan_items:<the step>', 'claude', $c$…$c$);

-- a comment that asks nothing and wants nothing done (and that you changed
-- nothing for) may be marked seen instead; see comments.md. The turn id is
-- on core.thread_turns for the ref.
select core.acknowledge_thread_turn('…', 'public.plan_items:<the step>', '<turn id>');
```

`started_at` and `completed_at` are kept by a trigger from the status; do not
write them. A step is never closed without a note.

## Recording what you wrote

Every write above except `start` is recorded with `core.record_dash_action`,
so Home lists it under what Dash did today with an Undo. The arguments are
the account, the row as `schema.table:id`, the op, what was done in
snake_case, and one finished sentence the person reads as it is: it names
Dash, says what happened to which row, and stays under 300 characters.

```sql
-- an insert (add, a decision, needs, an idea): once it has returned the id,
-- in the next call. The function reads the new row itself.
select core.record_dash_action('…', 'public.plan_items:<id>', 'insert', 'add_step',
  $s$Dash added step #1463, "Show the count on Home", under #1456.$s$);

-- an update (done, block, drop, fog, linking an idea): keep the row as it
-- is, write, then record, in one call. dash_before is what makes it undoable.
select core.dash_before('public.plan_items:<id>');
update plan_items set status = 'done', commit_sha = '…' where id = '<id>';
select core.record_dash_action('…', 'public.plan_items:<id>', 'update', 'close_step',
  $s$Dash closed step #1460, "Give routines one call to record their changes".$s$);
```

Kinds: `add_step`, `add_decision`, `close_step`, `block_step`, `drop_step`,
`write_fog`, `file_idea`, `link_idea`. The note that goes in its own
statement after the status goes in the same call, between the status update
and the record call, so the record holds both. A note written after the
record reads as a later change, and the Undo then refuses. If the call fails,
everything in it is rolled back, so fix it and send it again.


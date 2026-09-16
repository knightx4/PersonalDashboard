# When the CLI cannot run

`DATABASE_URL` is not set in Claude Code on the web, so `scripts/plan.ts`
exits immediately there. Fall back to the **`Supabase`** connector against
`plan_items` and `plan_dependencies` (both in `public`; project ref
`asjztutnqxbecruvyrbj`), and do not spend the session diagnosing it. The
brief a routine was fired with is the plan as it stood; trust it, and re-read
the row before closing it.

The reading rules are in `lib/plan/tree.ts` and are what the page uses; when
working by hand, apply the same ones:

```sql
-- the open steps, in reading order
select number, parent_id, title, status, priority, size, assignee, acceptance, comment
from plan_items
where user_id = '…' and status not in ('done', 'dropped')
order by module nulls last, position, created_at;

-- what a step waits on
select d.depends_on_id, p.number, p.title, p.status
from plan_dependencies d join plan_items p on p.id = d.depends_on_id
where d.item_id = '…';

-- a proposal, when shaping (steps beneath: same, with parent_id set)
insert into plan_items (user_id, module, title, detail, acceptance, size, status, position)
values ('…', 'shopping', '…', '…', '…', 'l', 'proposed', 10)
returning id, number;
update ideas set plan_item_id = '<the feature id>' where id = '<the idea id>';

-- a decision, when shaping: the question, its options, your recommendation.
-- Fog goes in the `fog` column of the feature the same insert creates.
insert into plan_items (user_id, module, parent_id, title, detail, kind, status, position)
values ('…', 'shopping', '<the feature id>', '…?', '…', 'decision', 'proposed', 20);

-- start (never on a proposed step, never on a decision)
update plan_items set status = 'in_progress' where id = '…';

-- done (after committing, so HEAD is the commit that did it)
update plan_items
set status = 'done', commit_sha = '…',
    comment = coalesce(comment || E'\n\n', '') || 'Done <date>: …'
where id = '…';

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

-- block: not finished, so no commit
update plan_items
set status = 'blocked',
    comment = coalesce(comment || E'\n\n', '') || 'Blocked <date>: <the question>'
where id = '…';

-- raise: what you need from the person, when it belongs to no step. `source`
-- says which run raised it and what it was doing; `module` is null for the app
-- as a whole. Never answer or dismiss one -- that is the person's move on
-- /dev/raised, the same as a decision.
-- `ask` is the move you want back, in one sentence answerable in one line;
-- the CLI refuses a raise without one and doing the insert by hand does not
-- make it optional.
-- `consequence` is what a yes does, in the shape lib/comments/act.ts carries
-- out: {"name": "file_idea" | "reword" | "send_step", "text": "…",
-- "module": "…" | null, "field": null}. The CLI refuses a raise without one
-- and doing the insert by hand does not make it optional either.
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
         from dev_comments c where c.raised_item_id = r.id
       ) as comments
from raised_items r
where r.user_id = '…' and r.status in ('open', 'answered')
order by r.created_at desc;

-- replying to an answer, which is how a raise takes a second round.
insert into dev_comments (user_id, raised_item_id, author, body)
values ('…', '<the raise>', 'claude', '…');

-- answering a question asked on a row. The same table, and which column is
-- set says what the question was about: `plan_item_id` a step or a decision,
-- `idea_id` an idea, `raised_item_id` a raise. Exactly one of the three.
insert into dev_comments (user_id, plan_item_id, author, body)
values ('…', '<the step>', 'claude', '…');
```

`started_at` and `completed_at` are kept by a trigger from the status; do not
write them. A step is never closed without a note.


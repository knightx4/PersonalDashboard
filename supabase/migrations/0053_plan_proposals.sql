-- Proposals: the step between an idea and the plan.
--
-- An idea is a sentence; a plan step is a thing with a parent, sub-steps, a
-- "done when" and a size, and writing that well takes knowing the code. So
-- the shaping is Claude's job and the approving is the person's: a session
-- reads the idea and the codebase and writes a feature with its steps into
-- the plan as *proposed*, and the person prunes, reorders and approves on the
-- page. A proposed step is never ready, never counts toward a module's
-- progress, and is never picked up by the routine. Only a person moves it on.
--
-- The link from the idea to the feature it became is what stops an idea
-- looking orphaned once it has been shaped, and what lets the ideas page say
-- "in the plan as #12" instead of showing a button that would shape it twice.
-- One direction, on the idea, because that is where the question "what
-- happened to this" gets asked. Set null on delete: a feature taken out of
-- the plan hands the idea back rather than taking it too.

set search_path = public, extensions;

alter table plan_items drop constraint if exists plan_items_status_ck;
alter table plan_items add constraint plan_items_status_ck
  check (status in ('proposed', 'not_started', 'in_progress', 'blocked', 'done', 'dropped'));

alter table ideas
  add column if not exists plan_item_id uuid references plan_items (id) on delete set null;

create index if not exists ideas_plan_item_idx on ideas (plan_item_id)
  where plan_item_id is not null;

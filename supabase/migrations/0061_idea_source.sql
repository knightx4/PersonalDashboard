-- Who wrote the idea.
--
-- Fog was being used as a parking space for follow-ons: a session finishing a
-- feature would write "and later we could also..." into the feature's fog,
-- where it sat on finished work and came back on every re-shape. Follow-ons
-- belong on the ideas page instead, but only if they can be told apart from
-- the ideas you wrote yourself -- otherwise your own list fills with
-- suggestions and stops being the thing you look at.
--
-- `source` is that. 'me' for an idea you filed, 'claude' for one a session
-- suggested. Text with a check rather than an enum, as everywhere else here:
-- a third writer is a migration of one line.
--
-- `from_plan_item_id` is where the suggestion came from, so a suggestion can
-- say which feature produced it. Null for anything you wrote and for a
-- suggestion with no single source. Set null on delete: a feature taken out of
-- the plan leaves the idea behind rather than taking it.

set search_path = public, extensions;

alter table ideas
  add column if not exists source text not null default 'me',
  add column if not exists from_plan_item_id uuid references plan_items (id) on delete set null;

alter table ideas drop constraint if exists ideas_source_ck;
alter table ideas add constraint ideas_source_ck check (source in ('me', 'claude'));

create index if not exists ideas_user_source_created_idx
  on ideas (user_id, source, created_at desc);

create index if not exists ideas_from_plan_item_idx on ideas (from_plan_item_id)
  where from_plan_item_id is not null;

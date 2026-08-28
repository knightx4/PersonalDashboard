set search_path = public, extensions;

alter table feedback_items
  -- 1 next, 2 normal, 3 someday. Bugs outrank features at equal priority.
  add column if not exists priority smallint not null default 2;

alter table feedback_items
  -- What was done, or what is being waited on. Never null once past open.
  add column if not exists resolution_note text;

alter table feedback_items
  -- The commit that closed it, so a change can be traced back to the ask.
  add column if not exists commit_sha text;

alter table feedback_items
  add column if not exists completed_at timestamptz;

alter table feedback_items
  drop constraint if exists feedback_priority_ck;
alter table feedback_items
  add constraint feedback_priority_ck check (priority between 1 and 3);

create index if not exists feedback_queue_idx
  on feedback_items (user_id, status, priority, created_at);

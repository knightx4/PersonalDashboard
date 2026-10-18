-- ---------------------------------------------------------------------------
-- 0018 -- a task can carry tags (plan #2340.1).
--
-- Any number per task, each a short lowercase name the person chose: "home",
-- "errands", "car". The lists filter by them later (plan #2340.3).
--
-- A table of their own rather than a text[] column on tasks, so that "every
-- task tagged home" is an index lookup and a tag goes when its task does by
-- the cascade, with no array surgery. Updating, finishing or reopening a task
-- writes to todo.tasks and never touches this table, so tags survive all three.
--
-- The tag is stored already normalised: trimmed, lowercased, 1 to 40
-- characters. The library normalises what it is given (lib/todo/tasks/tags.ts)
-- and the check below holds anything else to the same rule, so "Home" and
-- "home " can never sit beside "home" as different tags. The primary key makes
-- a tag unique per task.
--
-- No user_id: like task_links, a tag row is policed through its task. Reading
-- tags for a list is one embedded select on tasks, already scoped to the user.
-- ---------------------------------------------------------------------------

set search_path = todo, public, extensions;

create table if not exists todo.task_tags (
  task_id uuid not null references todo.tasks (id) on delete cascade,
  tag text not null,
  created_at timestamptz not null default now(),

  primary key (task_id, tag),
  constraint task_tags_tag_ck check (
    tag = lower(btrim(tag)) and tag <> '' and length(tag) <= 40
  )
);

-- The filter's read: which tasks carry this tag.
create index if not exists task_tags_tag_idx on todo.task_tags (tag);

comment on table todo.task_tags is
  'Tags on a task: trimmed, lowercased, 1 to 40 characters, unique per task. '
  'Deleted with the task. Policed through the task, like task_links.';

alter table todo.task_tags enable row level security;

create policy task_tags_all on todo.task_tags for all to authenticated
  using (exists (
    select 1 from todo.tasks t
    where t.id = task_tags.task_id and t.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from todo.tasks t
    where t.id = task_tags.task_id and t.user_id = (select auth.uid())
  ));

revoke all on todo.task_tags from anon;
grant select, insert, delete on todo.task_tags to authenticated, service_role;

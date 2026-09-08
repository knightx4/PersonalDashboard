-- The build plan, as rows rather than as prose.
--
-- `docs/BUILD-ORDER.md` and the per-module specs are the record of what was
-- decided and why, and they stay that. What they cannot be is a plan you work:
-- a deployed app cannot write to a file in the repository, the ✅ convention
-- has only two states where the question is "done, started, or not", and there
-- is nowhere in a paragraph to leave a note to yourself about why something
-- stalled.
--
-- So the plan lives here, seeded once from the build order and owned by the app
-- afterwards. The markdown is not read at runtime and is not kept in sync: it
-- is background reading, and this is the working copy. That divergence is the
-- deliberate cost of being able to add an item and mark one in progress.
--
-- `module` is a text column for the same reason `ideas.module` is: lib/modules
-- is the list that matters, and a module renamed there should leave a harmless
-- string here rather than a type that has to be migrated to match. Null means
-- the app as a whole.
--
-- `status` is text with a check rather than an enum, because this is a list
-- somebody is going to want another state on -- "blocked", "waiting on someone"
-- -- and a check constraint is one migration where an enum is three.

set search_path = public, extensions;

create table if not exists plan_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The workspace this step belongs to, or null for the app as a whole.
  module text,
  title text not null,
  -- What the step actually involves. The paragraph under the heading.
  detail text,
  status text not null default 'not_started',
  -- Your own note on it: why it stalled, what it is waiting for, what changed.
  comment text,
  -- Order within the module. Sparse on purpose, so one can be slotted between
  -- two others without renumbering the rest.
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_items_title_not_blank_ck check (length(btrim(title)) > 0),
  constraint plan_items_title_length_ck check (length(title) <= 200),
  constraint plan_items_detail_length_ck check (detail is null or length(detail) <= 4000),
  constraint plan_items_comment_length_ck check (comment is null or length(comment) <= 4000),
  constraint plan_items_module_length_ck check (module is null or length(module) <= 40),
  constraint plan_items_status_ck
    check (status in ('not_started', 'in_progress', 'done', 'dropped'))
);

create index if not exists plan_items_user_module_idx
  on plan_items (user_id, module, position);

drop trigger if exists plan_items_touch_updated_at on plan_items;
create trigger plan_items_touch_updated_at
  before update on plan_items
  for each row execute function public.touch_updated_at();

alter table plan_items enable row level security;

drop policy if exists plan_items_select on plan_items;
create policy plan_items_select on plan_items for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists plan_items_insert on plan_items;
create policy plan_items_insert on plan_items for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists plan_items_update on plan_items;
create policy plan_items_update on plan_items for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists plan_items_delete on plan_items;
create policy plan_items_delete on plan_items for delete to authenticated
  using (user_id = (select auth.uid()));

-- Said out loud rather than left to the project's default privileges, which is
-- the lesson 0050 had to learn twice. The grant is what makes the migration
-- true on a database rebuilt from the migrations alone; the revoke is because
-- those same defaults hand every new table to `anon`, and 0004's blanket
-- revoke could not reach forward to a table that did not exist yet.
grant select, insert, update, delete on plan_items to authenticated;

revoke all on table plan_items from anon;

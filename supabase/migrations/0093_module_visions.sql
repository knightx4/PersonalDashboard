-- The vision for a workspace: what it is for, in the person's own words.
--
-- Every other document on the specs page comes out of `docs/` and nothing in
-- the app may write one, which 0087 argues for at length and which still
-- holds: a document arguing for a design belongs in the commit that makes the
-- design. This is the one that is not that. It is written by the person rather
-- than by a session, it is the layer above every spec beneath it -- what the
-- workspace is for, which decides what gets built in it -- and it is edited
-- from the page it is read on, because a paragraph you have to open an editor
-- and land a commit to change is a paragraph that goes stale.
--
-- One row per person per workspace, which is what the primary key says. There
-- is no history and no draft: the vision is whatever it says now, and a
-- workspace with nothing written for it has no row at all rather than an empty
-- one. Clearing it deletes the row, so "is there a vision" is a question about
-- rows rather than about whitespace.
--
-- No comments hang off this one. `dev_comments` has five targets and a sixth
-- would want its own argument; a vision is short enough to argue with by
-- rewriting it, which is the point of it being editable here.

set search_path = public, extensions;

create table if not exists module_visions (
  -- Whose. Cascades, and leads the primary key, so the delete that follows an
  -- account being removed has an index to walk rather than the whole table.
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Which workspace, as its module id: 'shopping', 'learn'. Text rather than
  -- an enum, the same as raised_items.module and plan_items.module -- the set
  -- of workspaces is lib/modules.ts, and a type that has to be altered in a
  -- migration every time one is added is a second list to keep in step.
  module text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, module),
  constraint module_visions_module_not_blank_ck check (length(btrim(module)) > 0),
  -- Written rather than pasted: this is the highest layer of abstraction over
  -- a workspace, and something longer than the specs underneath it is not one.
  constraint module_visions_body_not_blank_ck check (length(btrim(body)) > 0),
  constraint module_visions_body_length_ck check (length(body) <= 8000)
);

drop trigger if exists module_visions_touch_updated_at on module_visions;
create trigger module_visions_touch_updated_at
  before update on module_visions
  for each row execute function public.touch_updated_at();

alter table module_visions enable row level security;

drop policy if exists module_visions_select on module_visions;
create policy module_visions_select on module_visions for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists module_visions_insert on module_visions;
create policy module_visions_insert on module_visions for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists module_visions_update on module_visions;
create policy module_visions_update on module_visions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists module_visions_delete on module_visions;
create policy module_visions_delete on module_visions for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on module_visions to authenticated;
revoke all on table module_visions from anon;

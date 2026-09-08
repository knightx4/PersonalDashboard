-- Long-term ideas: the ones with no work attached to them yet.
--
-- Deliberately not a third `feedback_kind`. The notes queue is worked top to
-- bottom and every row in it is a claim that something should be done soon; an
-- idea is the opposite -- "one day this could take receipts by photo" -- and
-- putting the two in one table means either ideas clogging the queue or the
-- queue's own statuses being bent to describe something nobody is doing.
--
-- `module` is the workspace it belongs to, or null for the app as a whole. A
-- text column rather than an enum: lib/modules.ts is the list that matters,
-- and a module renamed or removed there should leave a harmless string here
-- rather than a type that has to be migrated to match.

set search_path = public, extensions;

create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  -- The module it is about, or null for the whole app.
  module text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ideas_body_not_blank_ck check (length(btrim(body)) > 0),
  constraint ideas_body_length_ck check (length(body) <= 4000),
  constraint ideas_module_length_ck check (module is null or length(module) <= 40)
);

create index if not exists ideas_user_created_idx on ideas (user_id, created_at desc);

drop trigger if exists ideas_touch_updated_at on ideas;
create trigger ideas_touch_updated_at
  before update on ideas
  for each row execute function public.touch_updated_at();

alter table ideas enable row level security;

drop policy if exists ideas_select on ideas;
create policy ideas_select on ideas for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists ideas_insert on ideas;
create policy ideas_insert on ideas for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists ideas_update on ideas;
create policy ideas_update on ideas for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists ideas_delete on ideas;
create policy ideas_delete on ideas for delete to authenticated
  using (user_id = (select auth.uid()));

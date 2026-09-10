-- What a session needs from you, when it belongs to no step.
--
-- A run that notices something while building something else has nowhere to
-- put it. A risk it found in code it was only passing through, a question of
-- taste, a thing it will not decide alone: none of that is a bug report and
-- none of it belongs to one plan feature, so today it ends up in the routine
-- transcript, where it is only read by opening Claude. A row here is read on
-- /dev/raised instead, and answered or dismissed there.
--
-- Not a third `feedback_kind` and not a plan decision. `feedback_items` is
-- what you report as wrong and is worked top to bottom; a decision under a
-- plan feature is a question about that feature and closes when the feature
-- is built. This is for what has no other home, and it is written by a
-- session rather than by you.
--
-- `module` is text and nullable for the same reason as `ideas.module`: the
-- list that matters is lib/modules.ts, and a module renamed there should
-- leave a harmless string here. Null means the app as a whole.
--
-- `source` is what the session was doing -- the routine it was running and
-- the plan step or note it was on. Free text, because a run started by hand
-- has no number to give and an empty column would read as though nobody
-- raised it.
--
-- `status` is text with a check rather than an enum, matching plan_items: a
-- fourth state is one migration this way and three the other.

set search_path = public, extensions;

create table if not exists raised_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The workspace it is about, or null for the app as a whole.
  module text,
  title text not null,
  detail text,
  -- Which run raised it, and what it was doing at the time.
  source text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set when you answer it. Null while it is open, and left alone by a
  -- dismissal, which closes the row without saying anything.
  answered_at timestamptz,
  constraint raised_items_title_not_blank_ck check (length(btrim(title)) > 0),
  constraint raised_items_title_length_ck check (length(title) <= 200),
  constraint raised_items_detail_length_ck check (detail is null or length(detail) <= 4000),
  constraint raised_items_source_length_ck check (source is null or length(source) <= 200),
  constraint raised_items_module_length_ck check (module is null or length(module) <= 40),
  constraint raised_items_status_ck check (status in ('open', 'answered', 'dismissed'))
);

-- The order the page reads: open ones first, newest first within that.
create index if not exists raised_items_user_status_created_idx
  on raised_items (user_id, status, created_at desc);

drop trigger if exists raised_items_touch_updated_at on raised_items;
create trigger raised_items_touch_updated_at
  before update on raised_items
  for each row execute function public.touch_updated_at();

alter table raised_items enable row level security;

drop policy if exists raised_items_select on raised_items;
create policy raised_items_select on raised_items for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists raised_items_insert on raised_items;
create policy raised_items_insert on raised_items for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists raised_items_update on raised_items;
create policy raised_items_update on raised_items for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists raised_items_delete on raised_items;
create policy raised_items_delete on raised_items for delete to authenticated
  using (user_id = (select auth.uid()));

-- Said out loud rather than left to the project's default privileges, for the
-- reasons 0050 spells out: the grant is what makes this migration true on a
-- database rebuilt from the migrations alone, and the revoke is because those
-- same defaults hand every new table to `anon`.
grant select, insert, update, delete on raised_items to authenticated;

revoke all on table raised_items from anon;

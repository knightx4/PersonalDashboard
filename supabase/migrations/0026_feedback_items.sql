-- Bug reports and feature requests captured in the app.
--
-- The point is speed: catch the thought at the moment it happens, with the
-- page it happened on, instead of trying to reconstruct it later. Rows are
-- read back both in the app and directly from the database when the next
-- batch of work is planned.

set search_path = public, extensions;

do $$ begin
  create type feedback_kind as enum ('bug', 'feature');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type feedback_status as enum ('open', 'planned', 'done', 'declined');
exception when duplicate_object then null;
end $$;

create table if not exists feedback_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind feedback_kind not null,
  body text not null,
  -- Where the user was standing when they hit the problem.
  page_path text,
  user_agent text,
  status feedback_status not null default 'open',
  -- Filled in later, when the request is picked up.
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_body_not_blank_ck check (length(btrim(body)) > 0),
  constraint feedback_body_length_ck check (length(body) <= 4000)
);

create index if not exists feedback_user_created_idx
  on feedback_items (user_id, created_at desc);
create index if not exists feedback_status_idx on feedback_items (status);

drop trigger if exists feedback_items_touch_updated_at on feedback_items;
create trigger feedback_items_touch_updated_at
  before update on feedback_items
  for each row execute function public.touch_updated_at();

alter table feedback_items enable row level security;

drop policy if exists feedback_select on feedback_items;
create policy feedback_select on feedback_items for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists feedback_insert on feedback_items;
create policy feedback_insert on feedback_items for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists feedback_update on feedback_items;
create policy feedback_update on feedback_items for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists feedback_delete on feedback_items;
create policy feedback_delete on feedback_items for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on feedback_items to authenticated;

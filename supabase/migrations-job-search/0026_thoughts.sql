-- Thoughts: what you want from the next job and where you are now.
--
-- Free writing in dated entries rather than a set of fields. Career goals do
-- not come in a fixed shape, and a form with boxes for "target salary" and
-- "ideal company size" would ask for answers before the person has them. Each
-- entry is kept, so how the thinking moved is visible; where two disagree, the
-- newer one wins. Goals reads the table through the sources catalogue
-- (lib/jobs/sources.ts) when it maps a career goal.
--
-- Applied live on 25 September 2026 as job_search_0026_thoughts, before this
-- file reached main. The file matches that history statement for statement.

set search_path = job_search, extensions;

create table if not exists thoughts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint thoughts_body_not_blank_ck check (length(btrim(body)) > 0),
  constraint thoughts_body_length_ck check (length(body) <= 20000)
);

create index if not exists thoughts_user_created_idx
  on thoughts (user_id, created_at desc);

drop trigger if exists thoughts_touch_updated_at on thoughts;
create trigger thoughts_touch_updated_at
  before update on thoughts
  for each row execute function job_search.touch_updated_at();

alter table thoughts enable row level security;

drop policy if exists thoughts_select on thoughts;
create policy thoughts_select on thoughts for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists thoughts_insert on thoughts;
create policy thoughts_insert on thoughts for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists thoughts_update on thoughts;
create policy thoughts_update on thoughts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists thoughts_delete on thoughts;
create policy thoughts_delete on thoughts for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on thoughts to authenticated;
grant all on thoughts to service_role;
revoke all on thoughts from anon;

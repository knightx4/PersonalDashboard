-- Thoughts on the search: what you are looking for, and how that has changed.
--
-- Everything else in this schema records the search itself: roles, companies,
-- rounds, messages. None of it says what the person wants from the next job or
-- why, and the parts of the app that could use that (the Goals routine reading
-- a career goal, a fit judgement on a role) had nowhere to read it from.
--
-- Free text, dated, one row per entry. Deliberately no fields for salary,
-- location or seniority: this is where the person writes in their own words,
-- and a perspective that shifts is a new entry beside the old one rather than
-- an overwrite of it, so the history of the change is kept. Entries can still
-- be edited and deleted; the person owns them.

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

-- Every read is one person's entries, newest first.
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

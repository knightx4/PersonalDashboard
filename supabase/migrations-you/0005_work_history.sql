-- The jobs on You's Work & school tab (plan #1991.4).
--
-- One row per job the person has held. Dash fills it from their default
-- résumé in Jobs when they press the read button; they can correct a row or
-- add one it missed. Jobs keeps résumés as files and text and holds no list
-- of roles, so this is the only place the jobs are kept as rows.
--
-- Dates are a year ('2020') or a year and month ('2020-05'), as You's places
-- keep them, since a résumé rarely gives the day. `ended` null means the job
-- is the one they hold now.
--
-- `edited` is true once the person has changed a row or added it by hand. A
-- later read replaces the rows Dash wrote and never touches an edited one.
-- `resume_id` and `resume_hash` say which résumé text a row was read from, so
-- the tab can offer a new read when the default résumé has changed since;
-- both are null on a row the person added.

set search_path = you, public, extensions;

-- Also defined by the places migration; the same body, so whichever of the
-- two runs first, the trigger below has it.
create or replace function you.touch_updated_at()
returns trigger
language plpgsql
set search_path = you
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table you.work_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  employer text not null check (char_length(btrim(employer)) between 1 and 200),
  title text check (title is null or char_length(title) <= 200),
  place text check (place is null or char_length(place) <= 200),
  started text check (started is null or started ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$'),
  ended text check (ended is null or ended ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$'),
  note text check (note is null or char_length(note) <= 4000),
  edited boolean not null default false,
  resume_id uuid references job_search.resume_versions (id) on delete set null,
  resume_hash text check (resume_hash is null or resume_hash ~ '^[0-9a-f]{32}$'),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint work_history_ended_after_started_ck
    check (ended is null or started is null or ended >= started or left(ended, 4) = left(started, 4))
);

comment on table you.work_history is
  'The jobs the person has held, read by Dash from their default résumé or added by hand, newest first (plan #1991.4).';

create index work_history_user_started_idx on you.work_history (user_id, started desc nulls last);
create index work_history_resume_idx on you.work_history (resume_id) where resume_id is not null;

create trigger work_history_touch_updated_at
  before update on you.work_history
  for each row execute function you.touch_updated_at();

alter table you.work_history enable row level security;

create policy work_history_select on you.work_history for select to authenticated
  using (user_id = (select auth.uid()));

create policy work_history_insert on you.work_history for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy work_history_update on you.work_history for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy work_history_delete on you.work_history for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on you.work_history from anon, authenticated;
grant select, insert, update, delete on you.work_history to authenticated;
grant select, insert, update, delete on you.work_history to service_role;

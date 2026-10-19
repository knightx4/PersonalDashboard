-- The schools, certifications, honors, skills and courses from the person's
-- LinkedIn profile, on You's Work & school tab (plan #2432.7).
--
-- One row per entry, written by the LinkedIn import (lib/imports/linkedin-profile.ts)
-- through core.import_apply, which records each row's key in core.import_keys
-- so a rerun adds nothing twice and keeps a row the person changed.
--
-- kind says which list a row is in, and which columns it uses:
--
--   school         name, detail (the degree), started, ended,
--                  description (LinkedIn's notes), activities
--   certification  name, detail (the authority), started, ended, url,
--                  code (the license number)
--   honor          name (the title), started (issued on), description
--   skill          name
--   course         name, code (the course number); a course already on one of
--                  their transcripts (you.courses) is not imported
--
-- Dates are a year ('2016') or a year and month ('2016-05'), as
-- you.work_history keeps them. position is the entry's place in the export.
--
-- you.work_history gains `source`: null for a job read from the résumé or
-- added by hand, 'linkedin' for one the import wrote or filled in. A new read
-- of the résumé replaces only the rows it wrote itself, so it keeps these.
--
-- Schema only: no rows are changed.

set search_path = you, public, extensions;

create table you.profile_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  name text not null check (char_length(btrim(name)) between 1 and 300),
  detail text check (detail is null or char_length(detail) <= 300),
  started text check (started is null or started ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$'),
  ended text check (ended is null or ended ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$'),
  description text check (description is null or char_length(description) <= 4000),
  activities text check (activities is null or char_length(activities) <= 2000),
  url text check (url is null or char_length(url) <= 2000),
  code text check (code is null or char_length(code) <= 200),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profile_entries_kind_ck check (kind in ('school', 'certification', 'honor', 'skill', 'course'))
);

comment on table you.profile_entries is
  'The schools, certifications, honors, skills and courses on the person''s LinkedIn profile, as the import wrote them (plan #2432.7).';

create index profile_entries_user_kind_idx on you.profile_entries (user_id, kind, position);

create trigger profile_entries_touch_updated_at
  before update on you.profile_entries
  for each row execute function you.touch_updated_at();

alter table you.profile_entries enable row level security;

create policy profile_entries_select on you.profile_entries for select to authenticated
  using (user_id = (select auth.uid()));

create policy profile_entries_insert on you.profile_entries for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy profile_entries_update on you.profile_entries for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy profile_entries_delete on you.profile_entries for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on you.profile_entries from anon, authenticated;
grant select, insert, update, delete on you.profile_entries to authenticated;
grant select, insert, update, delete on you.profile_entries to service_role;

alter table you.work_history
  add column source text check (source is null or source = 'linkedin');

comment on column you.work_history.source is
  'Null for a job read from the résumé or added by hand; linkedin for one the LinkedIn import wrote or filled in, which a new read of the résumé keeps (plan #2432.7).';

-- Learning tracks suggested from the career goals (job_search.thoughts, 0026).
--
-- The Career goals page asks Claude which subjects the person should learn to
-- reach the job they describe. Each suggestion is a row here. Starting one
-- makes it a learning goal in Learn (learn.aims), which gives it a track with
-- its first units; the row keeps the goal's id so the page can list the tracks
-- started for the career and link each one.
--
--   name    the track's name, as the Learn goal will be named
--   about   one line on what the track covers, the Learn goal's line
--   depth   familiar, solid or deep, as learn.aims takes it
--   why     how the track serves the career goals, in terms of what they say
--   status  proposed until the person answers; started or dismissed after
--   aim_id  the Learn goal made on Start. No foreign key, because job_search
--           migrations run before learn's on a fresh database; a goal that
--           has gone reads as a started track with no goal.
--
-- One row per name per person, so a dismissed suggestion is not made again
-- and a started one is not offered twice.

set search_path = job_search, extensions;

create table if not exists learning_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  about text,
  depth text not null default 'familiar',
  why text not null,
  status text not null default 'proposed',
  aim_id uuid,
  model text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint learning_tracks_name_ck check (length(btrim(name)) between 1 and 200),
  constraint learning_tracks_about_ck check (about is null or length(about) <= 1000),
  constraint learning_tracks_why_ck check (length(btrim(why)) between 1 and 1000),
  constraint learning_tracks_depth_ck check (depth in ('familiar', 'solid', 'deep')),
  constraint learning_tracks_status_ck check (status in ('proposed', 'started', 'dismissed')),
  constraint learning_tracks_decided_ck check ((status = 'proposed') = (decided_at is null))
);

create unique index if not exists learning_tracks_user_name_uq
  on learning_tracks (user_id, lower(btrim(name)));

create index if not exists learning_tracks_user_status_idx
  on learning_tracks (user_id, status, created_at desc);

alter table learning_tracks enable row level security;

drop policy if exists learning_tracks_select on learning_tracks;
create policy learning_tracks_select on learning_tracks for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists learning_tracks_insert on learning_tracks;
create policy learning_tracks_insert on learning_tracks for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists learning_tracks_update on learning_tracks;
create policy learning_tracks_update on learning_tracks for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists learning_tracks_delete on learning_tracks;
create policy learning_tracks_delete on learning_tracks for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on learning_tracks to authenticated;
grant all on learning_tracks to service_role;
revoke all on learning_tracks from anon;

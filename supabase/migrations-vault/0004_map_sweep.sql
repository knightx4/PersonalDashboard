-- The sweep that reads every note into the map (plan #757).
--
-- Two tables and one function. A sweep is one pass over the whole vault in
-- path order. It is worked a few minutes at a time by /api/cron/map-sweep,
-- which a pg_cron job calls every five minutes
-- (supabase/migrations/0094_map_sweep_tick_cron.sql). Each call picks up from
-- `after_path`, so a sweep survives a deploy, a timeout or a stop without
-- anything having to keep a chain of invocations alive. The vault's own
-- backfill resumes the same way, from `backfill_after_path`.
--
--   map_sweeps        one row per sweep: its status, where it has reached, and
--                     the lease that stops two calls working it at once.
--   map_sweep_notes   one row per note the sweep reached: what happened to it
--                     and why. Also the two things no other table holds: the
--                     part of a note that was not read (chunkNote's skipped
--                     list) and the sections whose reading failed.
--
-- The sweep writes straight to the map through obsidian.accept_note_map rather
-- than leaving proposals for somebody to accept one note at a time. The review
-- queue in KNOWLEDGE-SPEC.md (build order step 6) works on the written map,
-- after the merge pass, and position_sources is indexed as "the review queue's
-- main read" for that reason.

set search_path = obsidian, public, extensions;

create table obsidian.map_sweeps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- running: the cron call works it. stopped: the person paused it, and
  -- setting it back to running resumes from after_path. done: every note was
  -- reached.
  status text not null default 'running',

  -- The last note path the sweep finished a batch at. Null before the first.
  after_path text,
  -- Live notes when the sweep started, so the page can say how far along it is.
  notes_total integer,

  -- Held by the call working the sweep. A call that dies holds it until it
  -- expires, and the next call after that takes over.
  lease_until timestamptz,
  -- Why the last call could not work it, such as a missing API key. Cleared
  -- by the next call that gets through a batch.
  last_error text,

  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint map_sweeps_status_ck check (status in ('running', 'stopped', 'done')),
  constraint map_sweeps_finished_ck check ((status = 'done') = (finished_at is not null))
);

alter table obsidian.map_sweeps add constraint map_sweeps_id_user_key unique (id, user_id);

-- One unfinished sweep per person. A second would read every note twice.
create unique index map_sweeps_one_open_idx on obsidian.map_sweeps (user_id)
  where status <> 'done';
create index map_sweeps_user_started_idx on obsidian.map_sweeps (user_id, started_at desc);
-- What the cron call reads every five minutes.
create index map_sweeps_running_idx on obsidian.map_sweeps (lease_until)
  where status = 'running';

create table obsidian.map_sweep_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sweep_id uuid not null,
  note_id uuid not null,

  -- The version of the note this row is about. A later sweep does not read a
  -- note again when an earlier one settled it at the same blob_sha.
  blob_sha text not null,

  -- reading      a call is on it now. Left behind only by a call that died,
  --              and the next call marks it failed.
  -- read         read and written to the map.
  -- unchanged    settled by an earlier sweep at this version, so not sent.
  -- journal      in a journal folder (Me/). Never sent.
  -- credential   contains what looks like an API key. Never sent.
  -- too_short    under 80 characters. Never sent.
  -- record       the first read judged it a record rather than an argument.
  -- nothing      read whole, and it argues nothing the map can hold.
  -- failed       a call or the write failed. `detail` says which.
  outcome text not null,
  -- The sentence the page shows beside a failure or a refusal.
  detail text,

  themes integer not null default 0,
  positions integer not null default 0,
  new_positions integer not null default 0,

  -- NoteSkip records from chunkNote: stretches past the 400,000-character cap.
  skipped jsonb not null default '[]'::jsonb,
  -- Sections whose reading failed, as {title, detail}. The rest of the note
  -- was still written.
  failed_chunks jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint map_sweep_notes_outcome_ck check (outcome in (
    'reading', 'read', 'unchanged', 'journal', 'credential', 'too_short',
    'record', 'nothing', 'failed'
  )),
  constraint map_sweep_notes_skipped_ck check (jsonb_typeof(skipped) = 'array'),
  constraint map_sweep_notes_failed_ck check (jsonb_typeof(failed_chunks) = 'array'),
  constraint map_sweep_notes_sweep_fk
    foreign key (sweep_id, user_id) references obsidian.map_sweeps (id, user_id) on delete cascade,
  constraint map_sweep_notes_note_fk
    foreign key (note_id, user_id) references obsidian.notes (id, user_id) on delete cascade,
  -- A note is reached once per sweep. A batch cut off halfway is re-planned
  -- without the notes it already reached.
  constraint map_sweep_notes_once_uq unique (sweep_id, note_id)
);

create index map_sweep_notes_sweep_outcome_idx on obsidian.map_sweep_notes (sweep_id, outcome);
-- "Was this version settled before", asked for each batch of a later sweep.
create index map_sweep_notes_note_idx on obsidian.map_sweep_notes (note_id, blob_sha);

-- ---------------------------------------------------------------------------
-- What a sweep has done so far, counted in the database rather than by
-- fetching 1,288 rows to the page. Security invoker, so RLS applies.
-- ---------------------------------------------------------------------------
create or replace function obsidian.map_sweep_counts(p_sweep_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = obsidian, pg_catalog
as $$
  select jsonb_build_object(
    'outcomes', coalesce(
      (select jsonb_object_agg(outcome, n) from (
        select outcome, count(*) as n
        from obsidian.map_sweep_notes
        where sweep_id = p_sweep_id
        group by outcome
      ) o),
      '{}'::jsonb
    ),
    'cutShort', (select count(*) from obsidian.map_sweep_notes
                 where sweep_id = p_sweep_id and jsonb_array_length(skipped) > 0),
    'sectionsFailed', (select count(*) from obsidian.map_sweep_notes
                       where sweep_id = p_sweep_id and jsonb_array_length(failed_chunks) > 0),
    'positions', (select coalesce(sum(positions), 0) from obsidian.map_sweep_notes
                  where sweep_id = p_sweep_id),
    'newPositions', (select coalesce(sum(new_positions), 0) from obsidian.map_sweep_notes
                     where sweep_id = p_sweep_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS.
--
-- The person starts, stops and resumes their own sweep through the session
-- client, so map_sweeps takes select, insert and update. The per-note rows
-- are written only by the cron call, which uses the service role, so a
-- signed-in person can read them and nothing else.
-- ---------------------------------------------------------------------------
alter table obsidian.map_sweeps enable row level security;
alter table obsidian.map_sweep_notes enable row level security;

create policy map_sweeps_select on obsidian.map_sweeps for select to authenticated
  using (user_id = (select auth.uid()));
create policy map_sweeps_insert on obsidian.map_sweeps for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy map_sweeps_update on obsidian.map_sweeps for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy map_sweep_notes_select on obsidian.map_sweep_notes for select to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update on obsidian.map_sweeps to authenticated;
grant select on obsidian.map_sweep_notes to authenticated;
grant select, insert, update, delete on obsidian.map_sweeps, obsidian.map_sweep_notes
  to service_role;

revoke all on obsidian.map_sweeps, obsidian.map_sweep_notes from anon;

revoke all on function obsidian.map_sweep_counts(uuid) from public, anon;
grant execute on function obsidian.map_sweep_counts(uuid) to authenticated, service_role;

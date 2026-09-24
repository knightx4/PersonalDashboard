-- The YouTube library: channels you follow, their playlists and videos, the
-- transcripts fetched for them, and a ledger of every paid transcript call.
--
-- Until now a lecture's words came only from the institution that published
-- it (0022's note on `catalogue_providers.ingest_note`), which left every
-- channel without its own transcript site at chapter markers or one segment
-- per video. Transcripts now come from TranscriptAPI, a paid service billed at
-- one credit per transcript returned. Listing what a channel has published
-- stays free, through the YouTube Data API.
--
-- Four changes:
--
--   **A channel is a provider.** 0022 made providers a table so that adding a
--   lecture channel would not be a migration. It already carries
--   `youtube_channel_id`; this adds the handle, the uploads playlist, when
--   the channel was last listed, and whether its new uploads are transcribed
--   without being asked.
--
--   **A video keeps its description.** Chapter markers live in it, and it is
--   what a list of unwatched videos shows under each title.
--
--   **`video_transcripts` records the state of each video's transcript**, keyed
--   by YouTube video id: queued, fetched, none (the video has no captions), or
--   failed. The words themselves are not stored in the database. They go to
--   the `learn-transcripts` storage bucket as gzipped JSON. The database is on
--   Supabase's free plan and already past its 500 MB, and a year of
--   transcripts at the planned rate is several hundred megabytes of text; the
--   bucket has a separate 1 GB allowance and gzip cuts transcript text by
--   about four times. What search needs from a transcript is already copied
--   into `catalogue_segments`.
--
--   **`transcript_calls` is the credit ledger.** One row per call to the
--   transcript endpoint, charged or not, so the app can say how many credits
--   this month has used against the plan and stop before it runs out.
--   Append-only for the reason `core.model_spend` is: there is no legitimate
--   edit to a record of a call that already happened.
--
-- All of it is reference data like the rest of the catalogue: readable by any
-- signed-in account, written only by the service role.

set search_path = learn, public, extensions;

-- ---------------------------------------------------------------------------
-- Channels.
-- ---------------------------------------------------------------------------
alter table learn.catalogue_providers
  -- `@MITOCW`, as the channel shows it. What the add form accepted, kept so a
  -- screen can show it rather than a 24-character id.
  add column if not exists youtube_handle text,
  -- `UU...`, from `channels.list`. Every upload is in it, newest first, which
  -- is what lets a re-list stop at the first video it has already seen.
  add column if not exists youtube_uploads_playlist_id text,
  add column if not exists youtube_listed_at timestamptz,
  -- Off by default: a channel like TED publishes thousands of videos, and
  -- transcribing each new one costs a credit.
  add column if not exists auto_transcribe boolean not null default false;

alter table learn.catalogue_providers drop constraint if exists catalogue_providers_youtube_handle_ck;
alter table learn.catalogue_providers add constraint catalogue_providers_youtube_handle_ck
  check (youtube_handle is null or youtube_handle ~ '^@[A-Za-z0-9._-]{1,100}$');

-- One provider per channel. Partial, because most providers are not channels.
create unique index if not exists catalogue_providers_youtube_channel_uq
  on learn.catalogue_providers (youtube_channel_id)
  where youtube_channel_id is not null;

-- ---------------------------------------------------------------------------
-- Video descriptions.
-- ---------------------------------------------------------------------------
alter table learn.catalogue_items
  add column if not exists description text;

alter table learn.catalogue_items drop constraint if exists catalogue_items_description_ck;
alter table learn.catalogue_items add constraint catalogue_items_description_ck
  check (description is null or length(description) <= 5000);

-- The newest videos of one channel, which is how the library page lists them.
create index if not exists catalogue_items_provider_published_idx
  on learn.catalogue_items (provider_id, published_at desc nulls last);

-- ---------------------------------------------------------------------------
-- Transcript state, one row per YouTube video.
--
-- Keyed by video id rather than by catalogue item, because the same video can
-- be in two channels' playlists and a transcript is a property of the video.
-- A row exists once a transcript has been asked for; no row means nobody has.
--
--   queued   -- asked for, not yet fetched; the cron works through these
--   fetched  -- the transcript is in the bucket at `storage_path`
--   none     -- TranscriptAPI answered 404: the video has no captions. Not
--               retried until `retry_after`, since captions are sometimes
--               added later
--   failed   -- a temporary error; retried on the next run, up to a limit
-- ---------------------------------------------------------------------------
create table if not exists learn.video_transcripts (
  video_id text primary key,
  state text not null default 'queued',

  -- What asked for it: a press on the library page, a channel's
  -- auto-transcribe, or a playlist pulled as a course.
  requested_by text not null,
  requested_at timestamptz not null default now(),

  fetched_at timestamptz,
  -- `en`, or `asr-en` for auto-generated captions, as TranscriptAPI reports it.
  language text,
  cue_count int,
  char_count int,
  storage_path text,

  attempts int not null default 0,
  last_error text,
  retry_after timestamptz,

  updated_at timestamptz not null default now(),

  constraint video_transcripts_video_id_ck check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint video_transcripts_state_ck check (state in ('queued', 'fetched', 'none', 'failed')),
  constraint video_transcripts_requested_by_ck check (requested_by in ('press', 'auto', 'course')),
  constraint video_transcripts_attempts_ck check (attempts >= 0),
  constraint video_transcripts_counts_ck check (
    (cue_count is null or cue_count >= 0) and (char_count is null or char_count >= 0)
  ),
  -- Fetched means the words are somewhere.
  constraint video_transcripts_fetched_ck check (
    state <> 'fetched' or (storage_path is not null and fetched_at is not null)
  )
);

drop trigger if exists video_transcripts_touch_updated_at on learn.video_transcripts;
create trigger video_transcripts_touch_updated_at
  before update on learn.video_transcripts
  for each row execute function learn.touch_updated_at();

-- The cron's read: what is waiting, oldest first.
create index if not exists video_transcripts_waiting_idx
  on learn.video_transcripts (requested_at)
  where state in ('queued', 'failed');

-- ---------------------------------------------------------------------------
-- The credit ledger.
--
-- `credits` is what TranscriptAPI charged: 1 for a transcript returned, 0 for
-- every error, including 404, 402 and 429. Failed calls are kept because a
-- run of 429s or 402s is the thing worth seeing when the numbers look wrong.
-- ---------------------------------------------------------------------------
create table if not exists learn.transcript_calls (
  id uuid primary key default gen_random_uuid(),
  called_at timestamptz not null default now(),

  video_id text not null,
  -- The HTTP status, or 0 when no response came back at all.
  status int not null,
  credits int not null,
  outcome text not null,
  -- What made the call: a press on the library page or the scheduled run.
  trigger text not null,
  detail text,

  constraint transcript_calls_video_id_ck check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint transcript_calls_credits_ck check (credits in (0, 1)),
  constraint transcript_calls_status_ck check (status >= 0 and status < 600),
  constraint transcript_calls_outcome_ck check (outcome in (
    'fetched', 'no-transcript', 'out-of-credits', 'rate-limited', 'unauthorized', 'error'
  )),
  constraint transcript_calls_trigger_ck check (trigger in ('press', 'scheduled'))
);

-- This month's total, and the newest calls.
create index if not exists transcript_calls_called_at_idx
  on learn.transcript_calls (called_at desc);

-- ---------------------------------------------------------------------------
-- RLS. Readable by any signed-in account, like the catalogue; written only by
-- the service role, which bypasses RLS. No insert, update or delete policy.
-- ---------------------------------------------------------------------------
alter table learn.video_transcripts enable row level security;
alter table learn.transcript_calls enable row level security;

drop policy if exists video_transcripts_select on learn.video_transcripts;
create policy video_transcripts_select on learn.video_transcripts for select to authenticated
  using (true);
drop policy if exists transcript_calls_select on learn.transcript_calls;
create policy transcript_calls_select on learn.transcript_calls for select to authenticated
  using (true);

grant select on learn.video_transcripts to authenticated;
grant select on learn.transcript_calls to authenticated;

grant all on learn.video_transcripts to service_role;
-- Append-only, for the service role too.
grant select, insert on learn.transcript_calls to service_role;

revoke all on table learn.video_transcripts from anon;
revoke all on table learn.transcript_calls from anon;

-- ---------------------------------------------------------------------------
-- The bucket. Private: the service role reads and writes it, and nothing is
-- served from it directly. Skipped where there is no storage schema, which is
-- the local test database.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'no storage schema here -- skipping the learn-transcripts bucket. Expected on the local test database.';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('learn-transcripts', 'learn-transcripts', false)
  on conflict (id) do nothing;
end;
$$;

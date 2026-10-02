-- The Inspiration tab's storage (plan #1407, under #1406).
--
-- Dash reads a YouTube playlist the person keeps for ideas about this app,
-- reads each video's transcript, and writes down the takeaways that could
-- change the app. When two videos make the same point it is one takeaway with
-- both videos under it, so crafting it into a plan makes one feature.
--
-- public.inspiration_settings, one row per person:
--   youtube_playlist_id  the playlist to read, as learn.settings keeps Learn's.
--   playlist_read_at     when the sync last listed it (#1408).
--   playlist_error       what YouTube said when it refused, for the tab to show.
--
-- public.inspiration_videos, one row per person and video:
--   title, channel_title, channel_id, duration_seconds, published_at,
--   thumbnail_url        YouTube's metadata, written by the sync (#1408).
--   playlist_position    the video's place in the playlist, for ordering.
--   left_playlist_at     set when a sync finds it gone, cleared if it comes
--                        back. The row and its takeaways are kept.
--   transcript_state     queued, fetched, none (no captions) or failed, as
--                        learn.video_transcripts names them. The words live in
--                        that cache and its storage bucket, keyed by video id,
--                        not here.
--   processed_at         when takeaways were last extracted (#1409); null means
--                        not read yet. takeaway_count and process_error say
--                        what that read found.
--
-- public.inspiration_takeaways, one row per distinct idea:
--   title, body          the clearer wording among the videos that make it.
--   module               the workspace it touches, as plan_items.module.
--   status               open; covered (#1410 found an idea or plan row that
--                        already has it); crafted (#1413 filed it and shaped a
--                        feature); dismissed (put aside on the tab).
--   idea_id, plan_item_id  the row that covers it or that crafting made.
--   embedding            a Voyage vector, 1024 wide, as core.memory_chunks,
--                        for #1410's comparison; embedding_model names it.
--
-- public.inspiration_takeaway_videos, which videos make each point:
--   said                 that video's own wording of the takeaway, kept when a
--                        merge picks another video's wording for the row.
--   quote, start_seconds the moment in the video that supports it.
--
-- None is a source for Goals: they are about building this app
-- (lib/dev/sources.ts).

set search_path = public, extensions;

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Settings.
-- ---------------------------------------------------------------------------
create table public.inspiration_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  youtube_playlist_id text,
  playlist_read_at timestamptz,
  playlist_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inspiration_settings_playlist_ck
    check (youtube_playlist_id is null or youtube_playlist_id ~ '^[A-Za-z0-9_-]{10,64}$')
);

create trigger inspiration_settings_touch_updated_at
  before update on public.inspiration_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Videos.
-- ---------------------------------------------------------------------------
create table public.inspiration_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  video_id text not null,

  title text,
  channel_title text,
  channel_id text,
  duration_seconds integer,
  published_at timestamptz,
  thumbnail_url text,
  playlist_position integer,

  added_at timestamptz not null default now(),
  left_playlist_at timestamptz,

  transcript_state text not null default 'queued',
  transcript_error text,

  processed_at timestamptz,
  takeaway_count integer,
  process_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inspiration_videos_user_video_key unique (user_id, video_id),
  constraint inspiration_videos_video_id_ck check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint inspiration_videos_duration_ck check (duration_seconds is null or duration_seconds >= 0),
  constraint inspiration_videos_transcript_state_ck
    check (transcript_state in ('queued', 'fetched', 'none', 'failed')),
  constraint inspiration_videos_takeaway_count_ck check (takeaway_count is null or takeaway_count >= 0)
);

create index inspiration_videos_user_added_idx on public.inspiration_videos (user_id, added_at desc);

create trigger inspiration_videos_touch_updated_at
  before update on public.inspiration_videos
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Takeaways.
-- ---------------------------------------------------------------------------
create table public.inspiration_takeaways (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  title text not null,
  body text not null,
  module text,

  status text not null default 'open',
  idea_id uuid references public.ideas (id) on delete set null,
  plan_item_id uuid references public.plan_items (id) on delete set null,
  crafted_at timestamptz,
  dismissed_at timestamptz,

  embedding extensions.vector(1024),
  embedding_model text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inspiration_takeaways_title_ck check (btrim(title) <> '' and char_length(title) <= 200),
  constraint inspiration_takeaways_body_ck check (btrim(body) <> '' and char_length(body) <= 4000),
  constraint inspiration_takeaways_status_ck
    check (status in ('open', 'covered', 'crafted', 'dismissed')),
  constraint inspiration_takeaways_covered_ck
    check (status not in ('covered', 'crafted') or idea_id is not null or plan_item_id is not null),
  constraint inspiration_takeaways_dismissed_ck check ((status = 'dismissed') = (dismissed_at is not null)),
  constraint inspiration_takeaways_embedding_ck check ((embedding is null) = (embedding_model is null))
);

create index inspiration_takeaways_user_status_idx
  on public.inspiration_takeaways (user_id, status, created_at desc);

create trigger inspiration_takeaways_touch_updated_at
  before update on public.inspiration_takeaways
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Which videos make each point.
-- ---------------------------------------------------------------------------
create table public.inspiration_takeaway_videos (
  takeaway_id uuid not null references public.inspiration_takeaways (id) on delete cascade,
  video_id uuid not null references public.inspiration_videos (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  said text,
  quote text,
  start_seconds integer,

  created_at timestamptz not null default now(),

  primary key (takeaway_id, video_id),
  constraint inspiration_takeaway_videos_start_ck check (start_seconds is null or start_seconds >= 0),
  constraint inspiration_takeaway_videos_quote_ck check (quote is null or char_length(quote) <= 2000)
);

create index inspiration_takeaway_videos_video_idx on public.inspiration_takeaway_videos (video_id);

-- ---------------------------------------------------------------------------
-- RLS: yours and only yours.
-- ---------------------------------------------------------------------------
alter table public.inspiration_settings enable row level security;
alter table public.inspiration_videos enable row level security;
alter table public.inspiration_takeaways enable row level security;
alter table public.inspiration_takeaway_videos enable row level security;

create policy inspiration_settings_all on public.inspiration_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy inspiration_videos_all on public.inspiration_videos for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy inspiration_takeaways_all on public.inspiration_takeaways for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy inspiration_takeaway_videos_all on public.inspiration_takeaway_videos for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.inspiration_settings from anon;
revoke all on public.inspiration_videos from anon;
revoke all on public.inspiration_takeaways from anon;
revoke all on public.inspiration_takeaway_videos from anon;

grant select, insert, update, delete on public.inspiration_settings to authenticated;
grant select, insert, update, delete on public.inspiration_videos to authenticated;
grant select, insert, update, delete on public.inspiration_takeaways to authenticated;
grant select, insert, update, delete on public.inspiration_takeaway_videos to authenticated;
grant all on public.inspiration_settings to service_role;
grant all on public.inspiration_videos to service_role;
grant all on public.inspiration_takeaways to service_role;
grant all on public.inspiration_takeaway_videos to service_role;

comment on table public.inspiration_settings is
  'Which YouTube playlist the Inspiration tab reads, and when it last did (plan #1407).';
comment on table public.inspiration_videos is
  'Videos from the inspiration playlist, their transcript state and when Dash read them (plan #1407).';
comment on table public.inspiration_takeaways is
  'One row per distinct idea Dash took from the inspiration videos, and what became of it (plan #1407).';
comment on table public.inspiration_takeaway_videos is
  'Which inspiration videos make each takeaway, with the supporting quote and moment (plan #1407).';

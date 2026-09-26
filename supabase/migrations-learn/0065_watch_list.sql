-- The videos you chose to watch, read from a YouTube playlist you keep (plan #1065).
--
-- YouTube's API answers an empty list for Watch later to every app, so the
-- person saves videos to a playlist of their own instead and pastes its link
-- into Learn. The library run lists that playlist four times a day and gives
-- each video a row here, pointing at the catalogue row of kind video that the
-- transcript and embedding code already reach.
--
-- One row per person and video. The columns after `left_playlist_at` are
-- empty until the later steps of the feature fill them: the judge (#1066)
-- writes verdict, why, the best stretch and judged_at; the Videos section
-- (#1069) writes the summary and watched_at; moving a video by hand (#1068)
-- sets verdict_by to 'you'.

create table if not exists learn.watch_list (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  video_id text not null,
  -- The catalogue row of kind video this is. Null only if that row is deleted.
  item_id uuid references learn.catalogue_items (id) on delete set null,
  came_from text not null default 'playlist',
  added_at timestamptz not null default now(),
  -- Set when a run finds the video gone from the playlist, cleared if it comes
  -- back. The row and its verdict are kept.
  left_playlist_at timestamptz,
  verdict text,
  verdict_by text,
  why text,
  best_start_seconds integer,
  best_end_seconds integer,
  judged_at timestamptz,
  summary text,
  key_points text[],
  summary_from text,
  summarised_at timestamptz,
  watched_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint watch_list_user_video_key unique (user_id, video_id),
  constraint watch_list_video_id_ck check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint watch_list_came_from_ck check (came_from in ('playlist', 'takeout')),
  constraint watch_list_verdict_ck check (verdict is null or verdict in ('watch', 'card', 'skip')),
  constraint watch_list_verdict_by_ck check (
    verdict_by is null or (verdict is not null and verdict_by in ('judge', 'you'))
  ),
  constraint watch_list_best_stretch_ck check (
    (best_start_seconds is null or best_start_seconds >= 0)
    and (best_end_seconds is null or best_start_seconds is null or best_end_seconds > best_start_seconds)
  ),
  constraint watch_list_summary_from_ck check (
    summary_from is null or summary_from in ('description', 'transcript')
  )
);

create index if not exists watch_list_user_added_idx on learn.watch_list (user_id, added_at desc);
create index if not exists watch_list_item_idx on learn.watch_list (item_id);

alter table learn.watch_list enable row level security;

drop policy if exists watch_list_all on learn.watch_list;
create policy watch_list_all on learn.watch_list for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on learn.watch_list to authenticated;
grant all on learn.watch_list to service_role;
revoke all on table learn.watch_list from anon;

comment on table learn.watch_list is
  'Videos the person chose to watch, one row per video: from their YouTube playlist (came_from playlist) '
  'or a Takeout import. item_id is the catalogue row of kind video. Judged, summarised and marked '
  'watched by the later steps of plan #1062.';

-- The playlist, in Learn settings. The run records when it last read it and
-- what YouTube said if it refused, so the settings can say so.
alter table learn.settings
  add column if not exists youtube_playlist_id text,
  add column if not exists youtube_playlist_read_at timestamptz,
  add column if not exists youtube_playlist_error text;

alter table learn.settings drop constraint if exists settings_youtube_playlist_id_ck;
alter table learn.settings add constraint settings_youtube_playlist_id_ck
  check (youtube_playlist_id is null or youtube_playlist_id ~ '^[A-Za-z0-9_-]{10,64}$');

comment on column learn.settings.youtube_playlist_id is
  'The YouTube playlist the library run reads into learn.watch_list (plan #1065).';

-- A playlist video whose channel Learn does not follow is stored in the
-- catalogue under this provider, with the channel's name as the author.
insert into learn.catalogue_providers (slug, name, home_url, licence, ingest_note, youtube_channel_id, enabled)
values (
  'youtube-list', 'Your YouTube list', 'https://www.youtube.com',
  'Standard YouTube licence unless a video states otherwise',
  'Videos from the playlist you keep for Learn, from channels Learn does not follow. Listed through the YouTube Data API; transcripts from TranscriptAPI.',
  null, true
)
on conflict (slug) do nothing;

-- Transcripts asked for because the video is on your list (#1066 queues them).
alter table learn.video_transcripts drop constraint if exists video_transcripts_requested_by_ck;
alter table learn.video_transcripts add constraint video_transcripts_requested_by_ck
  check (requested_by in ('press', 'auto', 'course', 'match', 'list'));

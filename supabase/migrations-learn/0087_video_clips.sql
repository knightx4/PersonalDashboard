-- Short clips cut from video transcripts, and which videos have been cut (plan #1397, under #1395).
--
-- The clip stream plays one short stretch of a video after another, each
-- making one point. Clips are cut from the timed transcript lines
-- (lib/learn/youtube/transcripts.ts), not from catalogue_segments, whose
-- windows are about four and a half minutes. Cutting is step #1398, scoring
-- with Jev #1401, picking what plays next #1399 and the player #1400. This
-- migration is the storage they share.
--
-- learn.video_clips, one row per clip:
--   video_id, item_id   the YouTube id, and the catalogue row of kind video
--                       it belongs to (null only if that row is deleted).
--   came_from           'playlist' for a video on the person's own playlist
--                       (learn.watch_list), 'channel' for one from a channel
--                       Learn follows. #1396 answered that playlist clips come
--                       first, so the picker reads this.
--   start_seconds,      where the clip starts and ends in the video. 20 to 90
--   end_seconds         seconds is the aim; the table allows 5 to 180 so a
--                       clip a little either side of that is kept, not lost.
--   caption             the one line shown over the clip.
--   idea                the point the clip makes, in a sentence.
--   serves              the track, goal or idea it is closest to, by name as
--                       the cutter wrote it, so it still reads after the
--                       track is deleted.
--   subject_id          that track (learn.subjects), when it is one. Cleared
--                       if the track is deleted.
--   goal_id             that goal (goals.items), when it is one. No foreign
--                       key: the goals migrations run after learn's, and a
--                       goal deleted leaves only a dangling id, which the
--                       picker treats as no goal.
--   cut_at              when it was cut.
--   score               1 to 100: how much it serves what the person is
--                       learning now. From Jev's weighted score (0 to 9)
--                       mapped onto 1 to 100, or Haiku's where Jev gave none.
--   score_by            'jev' or 'haiku'. score_confidence is Jev's, 0 to 1.
--   scored_at           when. Clips are scored again when tracks or goals
--                       change, so all four are rewritten in place.
--   shown_at            last time it started playing; show_count how often.
--   watched_seconds     how far into the clip they got the last time.
--   finished_at, skipped_at, saved_at, not_interested_at
--                       what they did with it, latest of each.
--
-- A re-cut of the same video updates the clip that starts at the same second
-- rather than adding a second one: unique on (user_id, video_id,
-- start_seconds).
--
-- learn.video_clip_cuts, one row per person and video cut, even a video that
-- gave no clips, so the cutting run (#1398) knows not to send it again.
-- clip_count is how many it kept; error what went wrong, if it did.
--
-- Both are Dash's cut of someone else's video and bookkeeping about it, not
-- something the person wrote: listed as not sources in lib/learn/sources.ts.

set search_path = learn, public, extensions;

create table if not exists learn.video_clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  video_id text not null,
  item_id uuid references learn.catalogue_items (id) on delete set null,
  came_from text not null,
  start_seconds integer not null,
  end_seconds integer not null,
  caption text not null,
  idea text,
  serves text,
  subject_id uuid,
  goal_id uuid,
  cut_at timestamptz not null default now(),

  score smallint,
  score_by text,
  score_confidence numeric(4, 3),
  scored_at timestamptz,

  shown_at timestamptz,
  show_count integer not null default 0,
  watched_seconds integer,
  finished_at timestamptz,
  skipped_at timestamptz,
  saved_at timestamptz,
  not_interested_at timestamptz,

  updated_at timestamptz not null default now(),

  constraint video_clips_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id)
    on delete set null (subject_id),
  constraint video_clips_user_video_start_uq unique (user_id, video_id, start_seconds),
  constraint video_clips_video_id_ck check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint video_clips_came_from_ck check (came_from in ('playlist', 'channel')),
  constraint video_clips_span_ck check (
    start_seconds >= 0 and end_seconds - start_seconds between 5 and 180
  ),
  constraint video_clips_caption_ck check (btrim(caption) <> '' and length(caption) <= 300),
  constraint video_clips_idea_ck check (idea is null or length(idea) <= 1000),
  constraint video_clips_serves_ck check (serves is null or length(serves) <= 300),
  constraint video_clips_score_ck check (score is null or score between 1 and 100),
  constraint video_clips_score_by_ck check (
    (score is null and score_by is null)
    or (score is not null and score_by in ('jev', 'haiku'))
  ),
  constraint video_clips_score_confidence_ck check (
    score_confidence is null or score_confidence between 0 and 1
  ),
  constraint video_clips_show_count_ck check (show_count >= 0),
  constraint video_clips_watched_ck check (watched_seconds is null or watched_seconds >= 0)
);

create or replace trigger video_clips_touch_updated_at
  before update on learn.video_clips
  for each row execute function learn.touch_updated_at();

-- The picker's read: clips not yet shown and not refused, best first.
create index if not exists video_clips_unseen_idx
  on learn.video_clips (user_id, score desc nulls last)
  where shown_at is null and not_interested_at is null;

create index if not exists video_clips_subject_idx
  on learn.video_clips (subject_id)
  where subject_id is not null;

create index if not exists video_clips_item_idx
  on learn.video_clips (item_id)
  where item_id is not null;

alter table learn.video_clips enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'video_clips' and policyname = 'video_clips_all'
  ) then
    create policy video_clips_all on learn.video_clips for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.video_clips from anon, authenticated;
grant select, insert, update, delete on learn.video_clips to authenticated;
grant select, insert, update, delete on learn.video_clips to service_role;

comment on table learn.video_clips is
  'Short clips cut from video transcripts for the clip stream, with their Jev score and what the '
  'person did with each (plan #1397).';

create table if not exists learn.video_clip_cuts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  video_id text not null,
  item_id uuid references learn.catalogue_items (id) on delete set null,
  came_from text not null,
  clip_count integer not null default 0,
  error text,
  cut_at timestamptz not null default now(),

  constraint video_clip_cuts_user_video_uq unique (user_id, video_id),
  constraint video_clip_cuts_video_id_ck check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint video_clip_cuts_came_from_ck check (came_from in ('playlist', 'channel')),
  constraint video_clip_cuts_clip_count_ck check (clip_count >= 0),
  constraint video_clip_cuts_error_ck check (error is null or length(error) <= 2000)
);

alter table learn.video_clip_cuts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'video_clip_cuts' and policyname = 'video_clip_cuts_all'
  ) then
    create policy video_clip_cuts_all on learn.video_clip_cuts for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.video_clip_cuts from anon, authenticated;
grant select, insert, update, delete on learn.video_clip_cuts to authenticated;
grant select, insert, update, delete on learn.video_clip_cuts to service_role;

comment on table learn.video_clip_cuts is
  'Each video cut into clips, even one that gave none, so the cutting run does not send it again '
  '(plan #1397).';

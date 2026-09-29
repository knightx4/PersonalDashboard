-- The three videos picked to judge a found channel by, kept until they are
-- judged (plan #1196, under #1185).
--
-- A channel found for a subject (#1195) is judged on three of its own videos
-- on that subject. The three are picked once, from the channel's uploads, and
-- their transcripts are fetched inside the month's credit allowance. What a
-- press cannot fetch stays queued for the scheduled run, so the picks have to
-- outlive the press that made them: picking again would spend the quota and
-- the Haiku call again, and could pick different videos after credits were
-- spent on the first ones.
--
-- learn.subject_channels.picks: null until the channel's uploads are read,
-- then [{"video_id", "title", "duration_seconds", "description"}], at most
-- three. An empty array means the channel had nothing on the subject to pick.
--
-- samples (0080) fills as each pick is judged, one entry per pick, and the
-- channel's verdict is written once every pick has one. Each entry keeps
-- what the video judge found beside the verdict and line 0080 names:
-- judged_from, best_start_seconds, best_end_seconds and stretches, which is
-- what #1197 needs to put a kept video in the Videos section without judging
-- it again.
--
-- learn.video_transcripts.requested_by gains 'channel', for transcripts asked
-- for to judge a found channel.

set search_path = learn, public, extensions;

alter table learn.subject_channels add column if not exists picks jsonb;

alter table learn.subject_channels drop constraint if exists subject_channels_picks_ck;
alter table learn.subject_channels add constraint subject_channels_picks_ck
  check (picks is null or (jsonb_typeof(picks) = 'array' and jsonb_array_length(picks) <= 3));

comment on column learn.subject_channels.picks is
  'The videos picked to judge the channel by, as [{video_id, title, duration_seconds, description}]; '
  'null until its uploads are read (plan #1196).';

alter table learn.video_transcripts drop constraint if exists video_transcripts_requested_by_ck;
alter table learn.video_transcripts add constraint video_transcripts_requested_by_ck
  check (requested_by in ('press', 'auto', 'course', 'match', 'list', 'channel'));

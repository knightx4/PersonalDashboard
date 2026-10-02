-- Transcripts asked for because the video is on the Dash inspiration playlist
-- (plan #1408). The Inspiration tab's sync fetches them through the same cache
-- and credit ledger as Learn, so a video on both lists is paid for once; this
-- value says which of the two asked first.
alter table learn.video_transcripts drop constraint if exists video_transcripts_requested_by_ck;
alter table learn.video_transcripts add constraint video_transcripts_requested_by_ck
  check (requested_by in ('press', 'auto', 'course', 'match', 'list', 'channel', 'inspiration'));

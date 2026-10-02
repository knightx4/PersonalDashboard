-- A short summary of each inspiration video (note b0594be6).
--
-- The Inspiration tab shows under each video only the takeaways that apply to
-- this app, so a video with none says nothing about what it covered. Dash now
-- writes three to five short points on what the video itself says, whether or
-- not they apply, and the tab shows them under the video's title.
--
-- public.inspiration_videos.summary_points
--   the points, in order; null until the video is summarised. Written by its
--   own Haiku pass (lib/dev/inspiration/summary.ts) after the takeaways, so
--   the videos read before this column existed get one on the next run
--   without their takeaways being read again.

alter table public.inspiration_videos add column if not exists summary_points text[];

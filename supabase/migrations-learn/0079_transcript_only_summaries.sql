-- Video summaries come from the transcript only.
--
-- A summary written from a video's description said what the video was about,
-- never what it said, and the person found them worth nothing. The library
-- run no longer writes them (lib/learn/youtube/summaries.ts), and this clears
-- the ones already stored so the page says why there is no summary instead.
-- A video whose transcript is in is summarised from it on the next run.

update learn.watch_list
set summary = null,
    key_points = null,
    summary_from = null,
    summarised_at = null,
    updated_at = now()
where summary_from = 'description';

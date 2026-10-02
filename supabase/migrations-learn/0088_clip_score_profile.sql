-- Which tracks and goals a clip's score was given against (plan #1401, under #1395).
--
-- A clip's score (learn.video_clips.score, 1 to 100) says how much it serves
-- what the person is learning, so it goes stale when they add or finish a
-- track or goal. The scoring run (lib/learn/clips/score-run.ts) writes here a
-- short fingerprint of the track and goal ids it scored against, and scores
-- again every clip not yet shown whose fingerprint differs from the person's
-- current one. Null on a clip never scored.

set search_path = learn, public, extensions;

alter table learn.video_clips
  add column if not exists score_profile text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'video_clips_score_profile_ck'
  ) then
    alter table learn.video_clips
      add constraint video_clips_score_profile_ck
      check (score_profile is null or length(score_profile) <= 64);
  end if;
end;
$$;

comment on column learn.video_clips.score_profile is
  'Fingerprint of the track and goal ids the score was given against; unseen clips whose fingerprint '
  'differs from the current one are scored again (plan #1401).';

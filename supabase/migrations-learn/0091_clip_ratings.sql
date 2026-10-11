-- Jev's three ratings of a clip, and the rating the stream ranks by.
--
-- The person asked for the clip stream to be ordered by what is good in a
-- clip, rated by Jev on three axes: how much it teaches, how entertaining it
-- is, and how well it is made. The rating run (lib/learn/clips/rate-run.ts)
-- reads each clip's title and transcript, asks Jev the three questions in one
-- request (Haiku where Jev cannot answer), and writes:
--
--   rating_educational    1 to 100: how much the viewer learns from it.
--   rating_entertainment  1 to 100: how engaging it is to watch.
--   rating_quality        1 to 100: how clear and well made it is.
--   rating                1 to 100: the three combined (combinedRating in
--                         lib/learn/clips/rank.ts). The stream orders by this,
--                         and by `score` for a clip not rated yet.
--   rated_by              'jev' or 'haiku'.
--   rated_at              when.
--
-- The ratings are about the clip itself, not the person's tracks, so a clip is
-- rated once and never again. All six are null on a clip not yet rated.

set search_path = learn, public, extensions;

alter table learn.video_clips
  add column if not exists rating_educational smallint,
  add column if not exists rating_entertainment smallint,
  add column if not exists rating_quality smallint,
  add column if not exists rating smallint,
  add column if not exists rated_by text,
  add column if not exists rated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'video_clips_rating_ck'
  ) then
    alter table learn.video_clips
      add constraint video_clips_rating_ck
      check (
        (
          rating_educational is null and rating_entertainment is null and rating_quality is null
          and rating is null and rated_by is null and rated_at is null
        )
        or (
          rating_educational between 1 and 100
          and rating_entertainment between 1 and 100
          and rating_quality between 1 and 100
          and rating between 1 and 100
          and rated_by in ('jev', 'haiku')
          and rated_at is not null
        )
      );
  end if;
end;
$$;

comment on column learn.video_clips.rating_educational is
  'Jev''s rating, 1 to 100, of how much a viewer learns from the clip.';
comment on column learn.video_clips.rating_entertainment is
  'Jev''s rating, 1 to 100, of how engaging the clip is to watch.';
comment on column learn.video_clips.rating_quality is
  'Jev''s rating, 1 to 100, of how clear and well made the clip is.';
comment on column learn.video_clips.rating is
  'The three ratings combined, 1 to 100; the clip stream ranks by it, and by score for a clip not yet rated.';
comment on column learn.video_clips.rated_by is
  'Which model gave the ratings: jev or haiku.';

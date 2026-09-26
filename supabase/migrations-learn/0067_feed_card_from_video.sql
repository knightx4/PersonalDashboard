-- Learn now cards written from videos on your playlist (plan #1067).
--
-- The judge (#1066) puts a video in the card pile with one to five stretches,
-- each a point with its start and end seconds. The feed top-up writes a card
-- from each stretch, through the same writer an article section goes through,
-- and stores it here with reason 'video'.
--
--   video_id             the YouTube id, so a card can be found from its row in
--                        learn.watch_list (user_id, video_id), and the Videos
--                        page can list the cards a video became.
--   video_start_seconds  the stretch the card was written from. The card plays
--   video_end_seconds    the video from the start.
--
-- item_id is the video's catalogue row and segment_id the transcript segment
-- the stretch starts in, so saving, Test me and Ask work on a video card as
-- they do on a section card. idea_index is the stretch's place in the list,
-- which keeps two stretches that start in one segment apart under
-- feed_cards_segment_idea_uq.
--
-- One card per stretch, whatever happens to the verdict: the unique index
-- below is what makes writing them again a no-op. When a video leaves the card
-- pile its unseen cards are set aside as dropped, and they come back as they
-- were if it returns, so nothing is written twice.

set search_path = learn, public, extensions;

alter table learn.feed_cards
  add column if not exists video_id text,
  add column if not exists video_start_seconds integer,
  add column if not exists video_end_seconds integer;

alter table learn.feed_cards drop constraint if exists feed_cards_reason_ck;
alter table learn.feed_cards add constraint feed_cards_reason_ck
  check (reason = any (array['interest', 'gap', 'goal', 'queued', 'lesson', 'unit_check', 'asked', 'teach_back', 'video']));

alter table learn.feed_cards drop constraint if exists feed_cards_target_ck;
alter table learn.feed_cards add constraint feed_cards_target_ck check (
  case reason
    when 'interest' then theme_name is not null and btrim(theme_name) <> ''
    when 'gap' then field_id is not null
    when 'goal' then aim_name is not null and btrim(aim_name) <> ''
    when 'lesson' then track_name is not null and btrim(track_name) <> ''
                   and idea_name is not null and btrim(idea_name) <> ''
    when 'unit_check' then track_name is not null and btrim(track_name) <> ''
                       and unit_title is not null and btrim(unit_title) <> ''
    when 'asked' then asked_phrase is not null and btrim(asked_phrase) <> ''
    when 'teach_back' then concept_id is not null and idea_name is not null and btrim(idea_name) <> ''
    when 'video' then video_id is not null and video_start_seconds is not null
    else reading_id is not null
  end
);

alter table learn.feed_cards drop constraint if exists feed_cards_video_ck;
alter table learn.feed_cards add constraint feed_cards_video_ck check (
  (video_id is null and video_start_seconds is null and video_end_seconds is null)
  or (reason = 'video' and video_start_seconds >= 0
      and (video_end_seconds is null or video_end_seconds > video_start_seconds))
);

create unique index if not exists feed_cards_video_stretch_uq
  on learn.feed_cards (user_id, video_id, video_start_seconds)
  where video_id is not null;

comment on column learn.feed_cards.video_id is
  'For a card written from a video on your playlist (reason video, plan #1067): the YouTube id, as in learn.watch_list.';
comment on column learn.feed_cards.video_start_seconds is
  'Where the stretch the card was written from starts; the card plays the video from here.';
comment on column learn.feed_cards.video_end_seconds is
  'Where that stretch ends.';

-- A Learn now card from a saved clip (plan #1405, under #1395).
--
-- Saving a clip on the Clips page queues a card about it: the hourly feed
-- top-up reads the saved clips with no card yet, writes one from the clip's
-- own transcript words through the same writer a card-pile stretch goes
-- through (lib/learn/clips/clip-cards.ts), and stores it as a video card
-- (reason 'video') that plays the video from the clip's start.
--
--   clip_id   the clip the card was written from. Null on every other card,
--             including the card-pile stretches, which the pile pass keeps in
--             step with the pile; a clip card is left out of that pass, so a
--             clip saved from a video outside the pile is not set aside.
--
-- One card per clip: the partial unique index below makes a second write for
-- the same clip a no-op. Deleting a clip leaves its card, which is what you
-- saved, and clears the link.

set search_path = learn, public, extensions;

alter table learn.feed_cards
  add column if not exists clip_id uuid references learn.video_clips (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'feed_cards_clip_ck'
  ) then
    alter table learn.feed_cards
      add constraint feed_cards_clip_ck check (clip_id is null or reason = 'video');
  end if;
end;
$$;

create unique index if not exists feed_cards_clip_uq
  on learn.feed_cards (user_id, clip_id)
  where clip_id is not null;

-- The run's read: saved clips, few per person.
create index if not exists video_clips_saved_idx
  on learn.video_clips (user_id, saved_at)
  where saved_at is not null;

comment on column learn.feed_cards.clip_id is
  'For a card written from a saved clip (plan #1405): the clip in learn.video_clips. Null otherwise.';

-- What the lecture clip on a Learn now card says, and why it is there
-- (note cde86a10).
--
-- A card is given the YouTube segment nearest its idea when it is dealt
-- (0058, video_clips_for_concepts). The segment is a stretch of raw
-- transcript with no heading, so the card could only say "Watch it
-- explained". The hourly top-up now writes two sentences about the clip for
-- each ready card that has one (lib/learn/feed/clip-note-run.ts), and the
-- card shows them under "In this video".
--
--   clip_note_segment_id  the segment the note was written about. The clip
--                         is chosen at deal time, so a lecture added later
--                         can replace it; the note is shown only while the
--                         dealt segment is still this one.
--   clip_said             what the clip says, in a sentence.
--   clip_why              why it fits this card's idea, in a sentence.

set search_path = learn, public, extensions;

alter table learn.feed_cards
  add column if not exists clip_note_segment_id uuid
    references learn.catalogue_segments (id) on delete set null,
  add column if not exists clip_said text,
  add column if not exists clip_why text;

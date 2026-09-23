-- What the person did to a Learn now card (plan #808).
--
-- docs/LEARN-NOW-SPEC.md, "What is recorded". The feed page records four
-- deliberate actions on the card's own row: opening the source, Save, Not
-- interested, and Test me on this. The first three already had a status. This
-- adds the fourth, and keeps what each of Save and Test me made, so a card can
-- be traced to the reading or the track that came out of it.
--
--   tested            the person pressed Test me on this, and a track was
--                     started from the card.
--   saved_reading_id  the reading Save put on the "Saved from Learn now"
--                     reading list. Set null if that reading is deleted.
--   subject_id        the track Test me on this started, or added to. Set null
--                     if that track is deleted.
--
-- Scrolling past a card, or pressing Next, records nothing.

set search_path = learn, public, extensions;

alter table learn.feed_cards drop constraint if exists feed_cards_status_ck;
alter table learn.feed_cards add constraint feed_cards_status_ck
  check (status in ('picked', 'ready', 'dropped', 'opened', 'saved', 'dismissed', 'tested'));

alter table learn.feed_cards
  add column if not exists saved_reading_id uuid
    references learn.readings (id) on delete set null;
alter table learn.feed_cards
  add column if not exists subject_id uuid
    references learn.subjects (id) on delete set null;

-- Foreign keys that a delete sets null through.
create index if not exists feed_cards_saved_reading_idx on learn.feed_cards (saved_reading_id)
  where saved_reading_id is not null;
create index if not exists feed_cards_subject_idx on learn.feed_cards (subject_id)
  where subject_id is not null;

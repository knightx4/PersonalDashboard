-- Learn now cards written from a research brief's sources (plan #2023.6).
--
-- When a brief is ready, each source on its reading list becomes one card,
-- with the reason 'researched'. The card names the reading it came from
-- (reading_id) and, through the reading's brief_id, the brief. It has no
-- catalogue item or segment: the writer reads the reading's fetched text or
-- the summary the research run wrote of the page, as a queued card has a
-- reading and nothing from the catalogue.
--
-- feed_cards_target_ck already asks every reason it does not name for a
-- reading_id, so 'researched' needs no branch of its own there.
--
-- One card per source: the unique index below is what makes writing a
-- brief's cards again, from the run or from the hourly top-up, a no-op.

set search_path = learn, public, extensions;

alter table learn.feed_cards drop constraint if exists feed_cards_reason_ck;
alter table learn.feed_cards add constraint feed_cards_reason_ck
  check (reason = any (array['interest', 'gap', 'goal', 'queued', 'lesson', 'unit_check', 'asked', 'teach_back', 'video', 'researched']));

alter table learn.feed_cards drop constraint if exists feed_cards_material_ck;
alter table learn.feed_cards add constraint feed_cards_material_ck check (
  reason = any (array['queued', 'lesson', 'unit_check', 'teach_back'])
  or (reason = 'researched' and reading_id is not null)
  or (item_id is not null and segment_id is not null)
);

create unique index if not exists feed_cards_researched_uq
  on learn.feed_cards (user_id, reading_id, idea_index)
  where reason = 'researched';

comment on column learn.feed_cards.reading_id is
  'The reading a queued card is, or the source a researched card (plan #2023.6) was written from.';

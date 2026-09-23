-- A paragraph of context at the top of every Learn now card.
--
-- docs/LEARN-NOW-SPEC.md, "Cards after the first week". The owner found cards
-- that went straight into an argument ("the section argues, following
-- Eisenstein...") without saying what the subject was, who the names were, or
-- when it happened. The writer now opens each card with one plain paragraph
-- that sets the scene at the person's level, and it is kept here.
--
-- Null on cards written before this. Those are no longer served as new ready
-- cards, so the top-up writes replacements; a card of that age that comes back
-- after a skip or "work on this" is still shown, without the paragraph.

set search_path = learn, public, extensions;

alter table learn.feed_cards add column if not exists context text;

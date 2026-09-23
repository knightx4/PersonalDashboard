-- Next takes a card out of the Learn now feed (plan #833, answering #819).
--
-- docs/LEARN-NOW-SPEC.md, "What is recorded". Pressing Next on a card marks it
-- `passed`, with `acted_at`, and the feed only shows `ready` cards, so a card
-- you passed is not shown again on a later visit. A pass is used for nothing
-- else: the draw's weighting (lib/learn/feed/preference.ts) counts saves and
-- Not interested only, and a passed card counts as neither.
--
-- The list below also keeps 'known', 'review' and 'skipped', which
-- learn_0037_feed_card_depth added to the live constraint from a branch not yet
-- on main. Leaving them out would make this migration reject rows that
-- migration allows.

set search_path = learn, public, extensions;

alter table learn.feed_cards drop constraint if exists feed_cards_status_ck;
alter table learn.feed_cards add constraint feed_cards_status_ck
  check (status in (
    'picked', 'ready', 'dropped', 'opened', 'saved', 'dismissed', 'tested',
    'known', 'review', 'skipped', 'passed'
  ));

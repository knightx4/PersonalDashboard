-- Learn now cards that teach something, and the three swipes.
--
-- docs/LEARN-NOW-SPEC.md, "Cards after the first week". The owner found the
-- first cards dull: a summary of a Wikipedia section is mostly definitions,
-- and the picks were pitched at someone who had never met the subject. Two
-- changes follow, and this adds what they need.
--
-- What a card carries. The summary stays, and the writer adds:
--
--   hook            the most interesting thing in the section, stated
--                   concretely, as the first thing on the card.
--   example         the idea applied to a real case or a worked number.
--   check_question  one question that makes you use the idea, and
--   check_answer    its answer, behind a tap.
--
-- How deep it is pitched. `depth` is the level the pick was made at, worked
-- out from how many cards on the same theme or field the person has marked as
-- known: 'working' (past the basics), 'advanced', or 'specialist'.
--
-- The three swipes, as statuses:
--
--   known     swiped down, "I'm good on this". The next picks on its theme or
--             field go a level deeper.
--   review    swiped right, "I need to work on this". The card comes back
--             after two days, and its theme is drawn again sooner.
--   skipped   swiped left, "not now". The card comes back after three days.
--
-- None of these is final the way Save or Not interested is: a card that comes
-- back can be swiped again, and acted_at moves each time.

set search_path = learn, public, extensions;

alter table learn.feed_cards add column if not exists hook text;
alter table learn.feed_cards add column if not exists example text;
alter table learn.feed_cards add column if not exists check_question text;
alter table learn.feed_cards add column if not exists check_answer text;
alter table learn.feed_cards add column if not exists depth text;

alter table learn.feed_cards drop constraint if exists feed_cards_depth_ck;
alter table learn.feed_cards add constraint feed_cards_depth_ck
  check (depth is null or depth in ('working', 'advanced', 'specialist'));

alter table learn.feed_cards drop constraint if exists feed_cards_status_ck;
alter table learn.feed_cards add constraint feed_cards_status_ck
  check (status in (
    'picked', 'ready', 'dropped', 'opened', 'saved', 'dismissed', 'tested',
    'known', 'review', 'skipped'
  ));

-- The ready check covers the three new statuses too: a card can only be swiped
-- once it was shown, and it was only shown with a summary.
alter table learn.feed_cards drop constraint if exists feed_cards_ready_ck;
alter table learn.feed_cards add constraint feed_cards_ready_ck check (
  status in ('picked', 'dropped') or reason = 'queued' or summary is not null
);

-- What the feed reads to bring skipped and review cards back once their wait
-- is over.
create index if not exists feed_cards_user_returning_idx
  on learn.feed_cards (user_id, status, acted_at)
  where status in ('review', 'skipped');

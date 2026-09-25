-- The unit check in Learn now (LEARN-LESSONS-SPEC, "The unit check", build
-- step 5; plan #971).
--
-- When every concept on the path to a unit's outcome is known, the top-up
-- writes one question that needs those concepts together, and the deck shows
-- it as the next card from that track. It can be answered in a sentence or
-- two, or skipped. Haiku marks an answer against the unit's outcome, and a
-- right answer marks the unit's concepts as tested.
--
-- A check is a row in learn.feed_cards with a sixth reason:
--
--   unit_check  subject_id is the track and unit_id the unit; track_name and
--               unit_title are what the card names. check_question holds the
--               question and check_answer the answer it expects, as they do
--               on a lesson.
--
-- feed_cards
--   check_concept_ids  the unit's concepts when the check was written: its
--                      goals and what they rest on that no earlier unit
--                      needed. A right answer marks these tested, so the
--                      answer is marked against the set the question was
--                      written from.
--   check_response     what the person wrote. Null until answered.
--   check_correct      Haiku's mark. Null until answered.
--   check_marked_why   Haiku's one sentence on the mark, shown on the card.
--
-- An answered check is `tested` and a skipped one `dismissed`, so neither
-- comes back. One check per unit per person: two top-ups running at once can
-- see the same done unit, and the second insert is refused.

set search_path = learn, public, extensions;

alter table learn.feed_cards
  add column if not exists check_concept_ids uuid[],
  add column if not exists check_response text,
  add column if not exists check_correct boolean,
  add column if not exists check_marked_why text;

alter table learn.feed_cards
  drop constraint if exists feed_cards_reason_ck,
  drop constraint if exists feed_cards_target_ck,
  drop constraint if exists feed_cards_material_ck;

alter table learn.feed_cards
  add constraint feed_cards_reason_ck
    check (reason in ('interest', 'gap', 'goal', 'queued', 'lesson', 'unit_check')),
  add constraint feed_cards_target_ck check (
    case reason
      when 'interest' then theme_name is not null and btrim(theme_name) <> ''
      when 'gap' then field_id is not null
      when 'goal' then aim_name is not null and btrim(aim_name) <> ''
      when 'lesson' then track_name is not null and btrim(track_name) <> ''
                         and idea_name is not null and btrim(idea_name) <> ''
      when 'unit_check' then track_name is not null and btrim(track_name) <> ''
                             and unit_title is not null and btrim(unit_title) <> ''
      else reading_id is not null
    end
  ),
  add constraint feed_cards_material_ck check (
    reason in ('queued', 'lesson', 'unit_check') or (item_id is not null and segment_id is not null)
  );

create unique index if not exists feed_cards_unit_check_uq
  on learn.feed_cards (user_id, unit_id)
  where reason = 'unit_check' and unit_id is not null;

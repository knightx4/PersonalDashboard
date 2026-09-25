-- Lessons in Learn now (LEARN-LESSONS-SPEC, build step 1; plan #978).
--
-- The top-up now writes a lesson for the next concept in each of the person's
-- tracks, and keeps one card in five as a section card from Wikipedia. A
-- lesson is a row in learn.feed_cards with a fifth reason:
--
--   lesson  a concept in one of the person's tracks. subject_id is the track
--           and concept_id the concept; track_name and unit_title are what the
--           card names under its title.
--
-- The track and unit are kept by name as well as by id, as a theme and a goal
-- are. subject_id and concept_id go null when the track or concept is deleted,
-- so the target check cannot ask for them without making that delete fail;
-- it asks for the names, which stay.
--
-- feed_cards
--   track_name         the track's name when the lesson was written.
--   unit_id            the curriculum unit the concept was taught in. Set null
--                      when the unit is deleted.
--   unit_title         that unit's title. Units are fixed once written.
--   source_item_id,
--   source_segment_id  the catalogue section the lesson was checked against
--                      and links to as "Read more", when one was close enough
--                      and supported the claim. Kept apart from item_id and
--                      segment_id because two lessons can cite one section,
--                      and (user_id, segment_id, idea_index) is the key the
--                      section picker's upsert relies on. On a lesson dropped
--                      because the section contradicts its claim, they name
--                      that section.
--
-- A lesson has no item or segment of its own, so the material check lets it
-- through, as it does a queued reading. One live lesson per concept per
-- person: two top-ups running at once can choose the same concept, and the
-- second insert is refused rather than served twice.
--
-- subjects
--   lessons_held_until  the top-up does not try to lay out a unit for this
--                       track before this time. Set about a day ahead when
--                       laying one out failed or found no unit to open, so a
--                       track that cannot be laid out does not cost a model
--                       call every hour. Its ready concepts are still taught.

set search_path = learn, public, extensions;

alter table learn.feed_cards
  add column if not exists track_name text,
  add column if not exists unit_id uuid references learn.curriculum_units (id) on delete set null,
  add column if not exists unit_title text,
  add column if not exists source_item_id uuid references learn.catalogue_items (id) on delete set null,
  add column if not exists source_segment_id uuid references learn.catalogue_segments (id) on delete set null;

alter table learn.feed_cards
  drop constraint if exists feed_cards_reason_ck,
  drop constraint if exists feed_cards_target_ck,
  drop constraint if exists feed_cards_material_ck;

alter table learn.feed_cards
  add constraint feed_cards_reason_ck
    check (reason in ('interest', 'gap', 'goal', 'queued', 'lesson')),
  -- Every card names its target, by the rule for its reason.
  add constraint feed_cards_target_ck check (
    case reason
      when 'interest' then theme_name is not null and btrim(theme_name) <> ''
      when 'gap' then field_id is not null
      when 'goal' then aim_name is not null and btrim(aim_name) <> ''
      when 'lesson' then track_name is not null and btrim(track_name) <> ''
                         and idea_name is not null and btrim(idea_name) <> ''
      else reading_id is not null
    end
  ),
  -- A picked card points at a stored section; a queued one at a reading; a
  -- lesson at its concept, with any section it cites in the source columns.
  add constraint feed_cards_material_ck check (
    reason in ('queued', 'lesson') or (item_id is not null and segment_id is not null)
  );

create unique index if not exists feed_cards_lesson_concept_uq
  on learn.feed_cards (user_id, concept_id)
  where reason = 'lesson' and concept_id is not null;

-- Foreign keys that a delete sets null through.
create index if not exists feed_cards_unit_idx on learn.feed_cards (unit_id)
  where unit_id is not null;
create index if not exists feed_cards_source_item_idx on learn.feed_cards (source_item_id)
  where source_item_id is not null;
create index if not exists feed_cards_source_segment_idx on learn.feed_cards (source_segment_id)
  where source_segment_id is not null;

alter table learn.subjects add column if not exists lessons_held_until timestamptz;

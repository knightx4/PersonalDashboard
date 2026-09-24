-- Where each open learning goal sits in the areas (plan #898).
--
-- 0044_aims.sql gave an aim its `field_id` and `domain_id`. This adds the rest
-- of what a track's placement carries (0032_subject_fields.sql), so an aim
-- that has not been placed yet can be told from one that spans domains:
--
--   field_id              the ordinary case.
--   domain_id             the aim covers a whole domain.
--   neither, with placed_at set
--                         the aim spans more than one domain, so there is
--                         nothing above a field to put it in. Kept with a
--                         basis so it is not sent to the model again.
--   placed_at null        not placed yet: the call has not run or it failed.
--                         Saving any goal, or changing this one's name or
--                         line, tries again (lib/learn/areas/place-aim.ts).
--
-- A list aim (the Level 3 goal) covers every field and is never placed, so
-- its placed_at stays null too; `list_source` is what tells it apart.
--
-- No runner-up field: nothing reads one for an aim, and the model's answer
-- keeps it in the basis sentence where it matters.

set search_path = learn, public, extensions;

alter table learn.aims
  add column if not exists placement_confidence text,
  -- Why it sits here, in a sentence.
  add column if not exists placement_basis text,
  add column if not exists placement_model text,
  add column if not exists placed_at timestamptz;

alter table learn.aims
  drop constraint if exists aims_placement_confidence_ck,
  drop constraint if exists aims_placement_basis_ck,
  drop constraint if exists aims_placement_complete_ck;

alter table learn.aims
  add constraint aims_placement_confidence_ck
    check (placement_confidence is null or placement_confidence in ('clear', 'close', 'none')),
  add constraint aims_placement_basis_ck
    check (placement_basis is null or btrim(placement_basis) <> ''),
  -- A placement is whole or absent, and a list aim has none.
  add constraint aims_placement_complete_ck
    check (
      case
        when placed_at is null then
          field_id is null and domain_id is null
          and placement_confidence is null and placement_basis is null
        else list_source is null
          and placement_confidence is not null and placement_basis is not null
      end
    );

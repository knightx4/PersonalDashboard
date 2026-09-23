-- Where each track sits in the areas.
--
-- docs/LEARN-AREAS-SPEC.md, "Placement". A track is a learn subject (decision
-- #774 renamed it on screen only). Placing tracks is what lets the Know page
-- show, for each field, how much of it you have been tested on alongside how
-- much of your writing falls there (0031_theme_fields.sql).
--
-- The placement lives on the subject rather than in a table of its own,
-- because a subject belongs to one account and is placed once, and the grid
-- reads every subject anyway. The columns mirror learn.theme_fields:
--
--   field_id              the ordinary case.
--   domain_id             the track covers a whole domain (the umbrella case).
--   neither, with placed_at set
--                         the track spans more than one domain, so there is
--                         nothing above a field to put it in. Kept with a
--                         basis so it is not sent to the model again.
--   placed_at null        not placed yet: the call failed or has not run. The
--                         next chain written into the track tries again.
--
-- A track started from a vault theme copies that theme's row from
-- learn.theme_fields. Any other track is placed by one model call when it is
-- created (lib/learn/areas/place-track.ts).

set search_path = learn, public, extensions;

alter table learn.subjects
  add column if not exists field_id uuid references learn.area_fields (id) on delete restrict,
  add column if not exists domain_id uuid references learn.area_domains (id) on delete restrict,
  -- The next best field, when the model named one.
  add column if not exists runner_up_field_id uuid references learn.area_fields (id) on delete set null,
  add column if not exists placement_confidence text,
  -- Why it sits here, in a sentence. Shown next to the placement.
  add column if not exists placement_basis text,
  add column if not exists placement_model text,
  -- True once you moved it yourself. Placement never overwrites such a row.
  add column if not exists placement_moved_by_hand boolean not null default false,
  add column if not exists placed_at timestamptz;

alter table learn.subjects
  drop constraint if exists subjects_placement_target_ck,
  drop constraint if exists subjects_placement_confidence_ck,
  drop constraint if exists subjects_placement_basis_ck,
  drop constraint if exists subjects_placement_complete_ck;

alter table learn.subjects
  -- A field or a domain, never both.
  add constraint subjects_placement_target_ck
    check (field_id is null or domain_id is null),
  add constraint subjects_placement_confidence_ck
    check (placement_confidence is null or placement_confidence in ('clear', 'close', 'none')),
  add constraint subjects_placement_basis_ck
    check (placement_basis is null or btrim(placement_basis) <> ''),
  -- A placement is whole or absent: once placed_at is set the confidence and
  -- basis are too, and nothing names a field or domain before it is.
  add constraint subjects_placement_complete_ck
    check (
      case
        when placed_at is null then
          field_id is null and domain_id is null and runner_up_field_id is null
          and placement_confidence is null and placement_basis is null
        else placement_confidence is not null and placement_basis is not null
      end
    );

-- What the grid reads: every track one account placed in each field.
create index if not exists subjects_user_field_idx on learn.subjects (user_id, field_id)
  where field_id is not null;
create index if not exists subjects_user_domain_idx on learn.subjects (user_id, domain_id)
  where domain_id is not null;

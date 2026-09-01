-- Merge the debrief into one field.
--
-- "Went well" and "went poorly" were two boxes on the theory that a single
-- one gets written as a paragraph and never reread. In practice it read as
-- two boxes to fill in before you could move on, and nobody had written
-- either one yet -- both are empty on every row in the table -- so this is a
-- straight rename rather than a data migration: one text column, "notes",
-- replaces both. `debrief` was a third, older column with the same idea,
-- never wired to any page and also empty everywhere; it goes too rather than
-- leaving two unused debrief-shaped columns behind.

set search_path = job_search, extensions;

alter table interviews add column notes text;
alter table interviews drop column went_well;
alter table interviews drop column went_poorly;
alter table interviews drop column debrief;

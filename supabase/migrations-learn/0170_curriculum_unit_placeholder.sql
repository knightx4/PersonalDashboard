-- Opening units the preparation may replace (plan #2276.5).
--
-- Adding a subject writes three or four opening units from its name alone,
-- before any syllabus is read. The preparation's write_units step rewrites
-- those from the subject's territory once it is drafted. A unit is marked
-- placeholder when the add wrote it from the name; a unit the person typed,
-- one written later, and every unit that existed before this column are not,
-- so the preparation keeps them.

alter table learn.curriculum_units
  add column if not exists placeholder boolean not null default false;

comment on column learn.curriculum_units.placeholder is
  'Written by the add from the subject''s name alone; the preparation''s write_units step replaces it with units read off the territory (plan #2276.5).';

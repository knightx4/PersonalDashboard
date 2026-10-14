-- Whether Subjects offers a new subject built from a theme in your notes
-- (plan #1937.10). Set from /learn/settings; on by default, which is how the
-- offer behaved before the setting existed.
--
-- Applied to the live project on 13 October 2026 as
-- learn_0112_offer_subjects_setting, before 0112 was taken on main by
-- 0112_idea_places; the name check matches it by its name without the number.

alter table learn.settings
  add column if not exists offer_subjects boolean not null default true;

comment on column learn.settings.offer_subjects is
  'Whether Subjects offers a new subject built from a theme in your notes. '
  'Set from Learn settings; true by default.';

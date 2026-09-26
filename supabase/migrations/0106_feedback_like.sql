-- A like: the third kind of note the feedback button files.
--
-- A bug says something is broken and a feature request asks for something
-- new. A like says something works and should be kept or taken further. It is
-- not work, so the notes queue leaves it alone (plan #1103), and the weekly
-- vision review is what reads it and closes it (docs/DIRECTION-SPEC.md,
-- feature 2).
--
-- 0048 and 0057 each chose not to add a third kind, because what they held
-- (ideas, raises) had its own life beyond the queue. A like does not: it is a
-- sentence filed from a page, with the page it was filed on, which is exactly
-- the shape of a feedback row.

set search_path = public, extensions;

alter type feedback_kind add value if not exists 'like';

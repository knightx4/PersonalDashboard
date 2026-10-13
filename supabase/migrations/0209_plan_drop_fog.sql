-- The plan no longer has fog (the "not yet specified" note on a feature).
--
-- Fog was one paragraph saying what could not yet be written as steps. In
-- practice three rows ever carried one, two of them on features already
-- shipped. What fog was for is covered by a decision under the feature when an
-- answer would settle it, and by a step that waits on something when time or
-- data would. Re-shaping now reads the answered decisions and writes the steps
-- they call for.
--
-- No text is lost: a row's fog is appended to its comment, dated, before the
-- columns go. The check and the index on them (0054, 0063) go with them.

update plan_items
set comment = coalesce(comment || E'\n\n', '')
  || to_char(now() at time zone 'utc', 'YYYY-MM-DD')
  || ' Not yet specified, kept when fog was removed: ' || fog
where coalesce(btrim(fog), '') <> '';

alter table plan_items drop column if exists fog_dismissed_at;
alter table plan_items drop column if exists fog;

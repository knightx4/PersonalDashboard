-- Goals no longer have fog (the note of what is not known yet about a goal).
--
-- One goal in the live data carried one. A goal you cannot describe yet goes
-- in with its title alone, and what is not known is asked as a question under
-- it. The night run no longer re-maps a goal when its fog changes: it maps a
-- goal once, when it is new.
--
-- No text is lost: a goal's fog is appended to its detail before the columns
-- go. Their checks (0001, 0014) go with them, and the guard that kept Claude
-- from putting fog aside (0014) is dropped, since there is nothing left for
-- it to guard.

update goals.items
set detail = coalesce(detail || E'\n\n', '') || 'Not known yet: ' || fog
where coalesce(btrim(fog), '') <> '';

drop trigger if exists items_fog_guard on goals.items;
drop function if exists goals.items_fog_guard();

alter table goals.items drop column if exists fog_dismissed_at;
alter table goals.items drop column if exists fog;

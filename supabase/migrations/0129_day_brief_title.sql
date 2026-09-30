-- The morning brief's notification title, and when the brief was opened
-- (plan #1240).
--
-- The notification is now written from the picks (0128): its title names the
-- first pick and its body the other two, short enough for a lock screen
-- (lib/day-brief/notification.ts). The title is stored beside the body so the
-- notification and the home page read the same words.
--
-- Columns
--
--   title      the notification's title, at most 50 characters; null on rows
--              written before this migration, which were sent as "Your day"
--   opened_at  when the person opened the brief; written by #1242, null until
--              then
--
-- body keeps its meaning: the text the notification carries under the title,
-- at most 180 characters on rows written from now on (checked in code, since
-- older rows are longer).

set search_path = core, public, extensions;

alter table core.day_briefs add column if not exists title text;
alter table core.day_briefs add column if not exists opened_at timestamptz;

alter table core.day_briefs drop constraint if exists day_briefs_title_ck;
alter table core.day_briefs add constraint day_briefs_title_ck
  check (title is null or (btrim(title) <> '' and length(title) <= 50));

comment on column core.day_briefs.title is
  'The notification title, at most 50 characters, naming the first pick; null before plan #1240.';
comment on column core.day_briefs.opened_at is
  'When the person opened this brief (plan #1242); null until they do.';

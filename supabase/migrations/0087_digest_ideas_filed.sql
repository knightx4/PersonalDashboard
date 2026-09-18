-- How many ideas the night filed, on the morning summary that reports them.
--
-- #623 settled that what the night notices about the board becomes ideas on
-- the ideas page instead of a card on Dash. Once they are filed there, nothing
-- on Dash says they arrived: the summary is an account of what closed, and a
-- new idea is neither a closed step nor a question. So the summary carries the
-- count and says it in a line above the day.
--
-- Stored rather than counted at render time, for the reason the rest of this
-- row is stored: the summary is written once a day and read all day. Counting
-- ideas by their age on every page load would say a different number after
-- lunch, and would count an idea filed by hand at noon as one the night wrote.
-- The run that files them knows exactly how many it wrote; this is where it
-- puts that number.
--
-- An integer column rather than a list, because nothing on the page names the
-- ideas -- it says how many and links to the page they are on.
--
-- Not null with a default of zero. Zero is the honest reading for every row
-- written before the column existed and for every night that filed nothing,
-- and both draw no line.

set search_path = public, extensions;

alter table dev_digests
  add column if not exists ideas_filed integer not null default 0;

alter table dev_digests
  drop constraint if exists dev_digests_ideas_filed_ck;
alter table dev_digests
  add constraint dev_digests_ideas_filed_ck
  check (ideas_filed >= 0);

comment on column dev_digests.ideas_filed is
  'How many ideas the overnight run filed on the ideas page in the window this summary covers. Zero on a night that filed none, and on every row written before the column existed.';

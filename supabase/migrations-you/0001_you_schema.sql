-- The You workspace: a ninth schema, for what is true about the person
-- (plan #1991, step #1991.1).
--
-- Empty on purpose. The workspace's first step builds its four tabs and
-- nothing that stores anything; the steps after it fill the schema:
--
--   #1991.2  personality results, moved here from learn
--   #1991.3  transcripts and courses, moved here from obsidian
--   #1991.4  work history read from the default résumé
--   #1991.5  the places the person has lived
--
-- Creating it now lets those four be built side by side, each adding its own
-- tables, rather than the first of them owning the schema and the others
-- waiting on it.
--
-- Grants follow news and goals: signed-in users and the service role reach it,
-- anon does not. Each table's own row level security does the rest, and every
-- table added here enables it in the migration that creates it.

create schema if not exists you;

revoke all on schema you from anon;
grant usage on schema you to authenticated, service_role;

-- Tables the later steps create get the same grants without each repeating
-- them, and anon gets nothing on any of them.
alter default privileges in schema you
  grant select, insert, update, delete on tables to authenticated, service_role;

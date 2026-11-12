-- Charts a bot drew with its text on People (plan #3050.2.2, under #3050.2).
--
-- A bot on People may now call show_chart, as Ask Dash does. What it drew is
-- kept on the bubble it goes with, the last of the reply, as an array of
-- charts in the shape lib/talk/chart.ts parses (DashChart). The thread reads
-- every chart back through parseChart, so one that no longer parses draws
-- nothing. The chart stays out of `text`, so the search index and voice
-- playback read the words alone.
--
-- Empty, the usual case, is a bubble with no chart. At most four charts a
-- bubble: a reply draws one or two.
--
-- Schema change only. No row of any account is written: the column's
-- default fills every existing row with an empty array.

set search_path = you, public, extensions;

alter table you.advisor_messages
  add column if not exists charts jsonb not null default '[]'::jsonb;

alter table you.advisor_messages
  drop constraint if exists advisor_messages_charts_ck;

alter table you.advisor_messages
  add constraint advisor_messages_charts_ck check (jsonb_typeof(charts) = 'array' and jsonb_array_length(charts) <= 4);

comment on column you.advisor_messages.charts is
  'The charts a bot drew with this message, as lib/talk/chart.ts parseChart returns them; empty for most (plan #3050.2.2).';

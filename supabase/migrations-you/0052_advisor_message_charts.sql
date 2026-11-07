-- The charts a bot drew with a message on People (plan #3050.2.2, under #3050).
--
-- A bot on People may now call show_chart, as Ask Dash does (lib/talk/chart.ts).
-- Each chart it draws is kept on the bubble it goes with, the last text of
-- that reply, so a reopened thread draws it again and Realtime brings it with
-- the row. A chart is the shape parseChart returns: kind, title, rows,
-- currency, unit, columns, reference and series. The app checks that shape
-- on the way in and again on the way out; the database holds only that it
-- is a list of at most four.
--
-- Schema change only. Every existing row takes the empty list, and no row of
-- any account is otherwise written.

set search_path = you, public, extensions;

alter table you.advisor_messages
  add column charts jsonb not null default '[]'::jsonb,
  add constraint advisor_messages_charts_ck
    check (jsonb_typeof(charts) = 'array' and jsonb_array_length(charts) <= 4);

comment on column you.advisor_messages.charts is
  'The charts a bot drew with this message, as lib/talk/chart.ts parseChart returns them; empty for most (plan #3050.2.2).';

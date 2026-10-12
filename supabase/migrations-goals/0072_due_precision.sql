-- ===========================================================================
-- Store how exact a goal's date is (plan #1839, feature #1838).
--
-- A goal's date was always a single day, so "sometime next spring" had to be
-- written as a made-up day and showed as overdue the day after it. The date
-- now says how much it means:
--
--   items.due_precision   'day' (the default), 'month', 'quarter', 'half' or
--                         'year'. What due_on is the end of.
--
-- items.due_on keeps holding one date, and for any precision but 'day' it is
-- the LAST day of the period (31 Mar 2027 for Q1 2027, 30 Jun for the first
-- half, 31 Dec for a year). That is what keeps every existing sort and
-- comparison working, and it is what makes "overdue" mean due_on < today at
-- every precision: a goal due in Q2 is not late until 1 July.
--
-- What the database holds every writer to:
--   - only a goal can be less exact than a day, so a step stays a day;
--   - a month, quarter, half or year date is the last day of its period, so a
--     run cannot store "Q2" as 15 May and have it read as overdue early.
--
-- Existing rows take 'day', so nothing already stored changes meaning. The
-- history trigger records every column of the row (0020), so the precision is
-- in history and a run's undo puts it back with the date.
-- ===========================================================================

alter table goals.items
  add column due_precision text not null default 'day';

alter table goals.items
  add constraint items_due_precision_ck
  check (due_precision in ('day', 'month', 'quarter', 'half', 'year'));

alter table goals.items
  add constraint items_due_precision_level_ck
  check (due_precision = 'day' or level = 'goal');

alter table goals.items
  add constraint items_due_period_end_ck
  check (
    due_precision = 'day'
    or due_on is null
    or due_on = case due_precision
      when 'month' then (date_trunc('month', due_on) + interval '1 month - 1 day')::date
      when 'quarter' then (date_trunc('quarter', due_on) + interval '3 months - 1 day')::date
      when 'half' then make_date(
        extract(year from due_on)::int,
        case when extract(month from due_on) <= 6 then 6 else 12 end,
        case when extract(month from due_on) <= 6 then 30 else 31 end)
      when 'year' then make_date(extract(year from due_on)::int, 12, 31)
    end
  );

comment on column goals.items.due_precision is
  'How exact due_on is: day, month, quarter, half or year (plan #1839). Anything but day means due_on is the last day of that period, so due_on < today is overdue at every precision.';

notify pgrst, 'reload schema';

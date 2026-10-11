-- A one-line summary on a plan row (plan #1670).
--
-- The compose surface a feature is written in has a title, a one-line
-- summary under it, a row of chips and then the free description, as Linear
-- writes a project. The summary is what the feature page shows under its
-- title, so the description can stay the long account of the work. Any row
-- may carry one; only features are given one from the page. Null where none
-- was written, which is every row written before this.

alter table plan_items
  add column if not exists summary text;

alter table plan_items add constraint plan_items_summary_len_ck
  check (summary is null or char_length(summary) <= 200);

comment on column plan_items.summary is
  'One line saying what the row is, shown under its title. Null when none was written.';

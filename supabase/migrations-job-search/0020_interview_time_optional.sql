-- An interview is often agreed before its hour is.
--
-- `scheduled_at` has always been nullable, but nothing could write a round
-- without one: the add form demanded a datetime-local before it would submit,
-- so "second round, sometime the week of the 15th" had nowhere to go and
-- "they said yes to an onsite, dates to follow" could not be recorded at all.
--
-- Allowing the day without the hour needs one more bit than the timestamp
-- carries. A round stored at midnight is indistinguishable from a round that
-- genuinely starts at midnight, and rendering the first as "15 Sep, 00:00" is
-- a time the user never said. `time_known` is that bit: false means only the
-- date in `scheduled_at` is meant, and the hour is not to be shown.
--
-- Default true, because every row that exists came from a calendar invite or a
-- datetime the user typed, and both of those know their hour.

set search_path = job_search, extensions;

alter table interviews
  add column if not exists time_known boolean not null default true;

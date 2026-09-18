-- The written account at the top of the morning summary.
--
-- `happened` is every row that closed in the window, and on a busy day that is
-- a list rather than a summary: yesterday's ran to fifty-four lines, one per
-- closed step, which is a thing to scroll past rather than to read. The page
-- now groups those lines under the feature they belong to and shows the first
-- fifteen, and above them it wants two or three sentences saying what the day
-- amounted to.
--
-- That is a reading rather than a query, the same as the "worth a look" list
-- next to it, so it is written by the same model call the daily cron already
-- makes and stored the same way. Nullable, because the cron writes the factual
-- half whether or not the call comes back -- without ANTHROPIC_API_KEY it is
-- simply absent -- and because every summary written before this column
-- existed has none.

set search_path = public, extensions;

alter table dev_digests
  add column if not exists summary text;

alter table dev_digests
  drop constraint if exists dev_digests_summary_length_ck;
alter table dev_digests
  add constraint dev_digests_summary_length_ck
  check (summary is null or length(summary) <= 2000);

alter table dev_digests
  drop constraint if exists dev_digests_summary_not_blank_ck;
alter table dev_digests
  add constraint dev_digests_summary_not_blank_ck
  check (summary is null or length(btrim(summary)) > 0);

comment on column dev_digests.summary is
  'Two or three sentences on what the day amounted to, written by the same model call as the suggestions. Null when there was no call, and on every row written before the column existed.';

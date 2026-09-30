-- A search that runs out of time finishes as a Message Batch.
--
-- The web search behind Recommended roles can take longer than the five
-- minutes a Vercel request may run. The first press after 0040 stopped at
-- 117 seconds with nothing saved. Now a search whose time runs out hands the
-- exact request it was about to make to the Message Batches API, which has no
-- time limit (most finish within the hour), and the run waits in stage
-- 'queued'. /api/cron/job-search-batches (migration 0133) collects finished
-- batches every ten minutes, reads them as a live search is read, stores
-- what they found and closes the run.
--
--   batch_id    the batch holding the request.
--   request     the Messages request itself, kept so a batch that ends
--               without a report can be followed by the forced-report
--               request, as a live search is.
--   board_urls  the followed-board postings offered to the search, as
--               [{url, company}], so a role found on one is stored with that
--               origin when the batch comes back.
--   follow_ups  how many follow-up batches were sent; one at most.

set search_path = job_search, extensions;

alter table search_runs add column if not exists batch_id text;
alter table search_runs add column if not exists request jsonb;
alter table search_runs add column if not exists board_urls jsonb;
alter table search_runs add column if not exists follow_ups integer not null default 0;

alter table search_runs drop constraint if exists search_runs_stage_ck;
alter table search_runs add constraint search_runs_stage_ck check
  (stage in ('boards', 'searching', 'saving', 'queued', 'postings', 'scoring', 'done', 'failed'));

create index if not exists search_runs_queued_idx on search_runs (started_at) where stage = 'queued';

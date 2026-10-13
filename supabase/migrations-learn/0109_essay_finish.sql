-- Finishing an essay (plan #1873, under #1863; LEARN-ESSAYS-SPEC "Finishing
-- and publishing").
--
-- Finish logs the essay in the learning log with the claims it argues, and
-- may add it to the Jobs evidence bank. Both are done once per essay, so each
-- needs a mark to find the earlier one: pressing Finish again updates the log
-- entry and never adds a second evidence item.
--
-- The evidence item lives in the job_search schema, so its id is kept here
-- without a foreign key.

alter table learn.essays
  add column if not exists finished_at timestamptz,
  add column if not exists evidence_item_id uuid;

comment on column learn.essays.finished_at is
  'When Finish last ran on the essay (plan #1873); null while it is a draft.';
comment on column learn.essays.evidence_item_id is
  'The job_search.evidence_items row made from this essay, once the person added it (plan #1873).';

alter table learn.learning_log
  add column if not exists essay_id uuid references learn.essays (id) on delete set null;

-- One log entry per essay: Finish pressed again updates it.
create unique index if not exists learning_log_essay_idx
  on learn.learning_log (essay_id) where essay_id is not null;

comment on column learn.learning_log.essay_id is
  'The essay this entry records, when it came from finishing one (plan #1873).';

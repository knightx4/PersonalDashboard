-- The role title a held message names, for the review queue (note b48d2b61).
--
-- A message the linker could not settle waits on /jobs/review with three
-- suggested roles, scored again on the page. The body is never stored, so the
-- page scored on sender and subject alone, and two roles at one company came
-- out level even when the email said which role it was about. This keeps the
-- one fact the page needs from the body: the role title, as the extractor read
-- it or as the body names one of your roles word for word. A title, not text
-- from the message.

alter table job_search.ingested_messages
  add column if not exists role_hint text;

comment on column job_search.ingested_messages.role_hint is
  'The role title the message names, read at ingestion, so the review queue can tell roles at one company apart without the body.';

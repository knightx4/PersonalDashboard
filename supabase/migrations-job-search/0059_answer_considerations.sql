-- What to weigh before answering an application question, kept with the answer.
--
-- The drafter used to report the claims it could not ground, and the card
-- showed them as a warning. It now works out first what the question is
-- testing, what a strong answer leads with, which story fits and what the
-- material is missing, writes the answer from that, and the card shows those
-- considerations in place of the warning. Kept on the row so they survive the
-- reload between drafting and submitting, as unsupported_claims did.

alter table job_search.application_answers
  add column if not exists considerations text[] not null default '{}';

comment on column job_search.application_answers.considerations is
  'How to approach this question, from the draft the answer came from: what it tests, what to lead with, what the material lacks.';

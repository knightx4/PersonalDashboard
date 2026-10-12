-- What a run that finished without doing its job says about why.
--
-- A posts run asked for one draft can refuse it: the ask needed something the
-- rules keep out, or nothing shipped bears on it. Its reply went only to the
-- session transcript, so the Posts tab showed a finished run and no draft,
-- which reads as a lost request. The run now writes its reason here, and the
-- tab shows it under the button.
--
-- Separate from `error`, which a check ties to a failed status: a run that
-- declines has finished, and says why.

set search_path = public, extensions;

alter table plan_runs add column if not exists note text;

alter table plan_runs drop constraint if exists plan_runs_note_length_ck;
alter table plan_runs add constraint plan_runs_note_length_ck
  check (note is null or length(note) <= 1000);

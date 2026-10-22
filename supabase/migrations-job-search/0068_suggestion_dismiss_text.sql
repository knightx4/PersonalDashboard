-- The words the person typed when they turned a recommended role down.
--
-- dismiss_reason (0039) is one of a fixed list of reasons. dismiss_text holds
-- the free text typed into the Not for me box (plan #2504), null when they
-- declined without typing anything. It is cleared when a decline is undone,
-- alongside dismiss_reason. Schema only; job_search.suggestions is already in
-- the sources catalogue, so that does not change.

alter table job_search.suggestions
  add column if not exists dismiss_text text;

alter table job_search.suggestions
  drop constraint if exists suggestions_dismiss_text_length_ck;
alter table job_search.suggestions
  add constraint suggestions_dismiss_text_length_ck
  check (dismiss_text is null or length(dismiss_text) <= 2000);

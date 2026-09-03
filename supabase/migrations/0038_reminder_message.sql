-- Let a to-do point at the email that asked for it.
--
-- "Submit the take-home" and the mail that sent the take-home are the same
-- thing seen twice, and they sat in two different tabs with nothing joining
-- them: the to-do said what to do and the mail said what to do it about, and
-- finding the second from the first meant remembering the subject line.
--
-- The same nullable reference application_events already carries, with the
-- same rule: a scrubbed or deleted envelope clears the link and leaves the
-- to-do standing, because what you have to do does not stop being true when
-- the mail it came from is gone.

alter table job_search.reminders
  add column ingested_message_id uuid
    references job_search.ingested_messages (id) on delete set null;

create index reminders_message_idx
  on job_search.reminders (ingested_message_id)
  where ingested_message_id is not null;

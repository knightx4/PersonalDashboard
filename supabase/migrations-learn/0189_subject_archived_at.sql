-- A subject can be archived and restored later.
--
-- archived_at is when the person archived the subject; null means it is live.
-- Every existing subject stays null. Schema only; no existing row is changed.
-- The index lets readers filter a person's live or archived subjects cheaply.

alter table learn.subjects
  add column if not exists archived_at timestamptz;

comment on column learn.subjects.archived_at is
  'When the person archived the subject; null while it is live. Restoring sets it back to null.';

create index if not exists subjects_user_archived_idx
  on learn.subjects (user_id, archived_at);

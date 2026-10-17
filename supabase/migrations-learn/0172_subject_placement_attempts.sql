-- A failed placement is recorded and not retried hourly (plan #2297.1).
--
-- The hourly theme-placement tick picked every subject with placed_at null and
-- wrote nothing when the model gave no placement for one, so a subject it
-- could not place was tried and paid for every hour. In the week to 17
-- October that was 125 of 168 hours of place-track for one survey subject.
--
-- learn.subjects gains:
--   placement_attempts     how many times the sweep tried to place the subject
--                          and got no placement; three and it is left alone
--   last_placement_error   what the last failed attempt said
--
-- Changing the name or the note starts the count again, so a subject the
-- person rewrites is tried afresh. Schema only; no existing row is changed.

alter table learn.subjects
  add column if not exists placement_attempts integer not null default 0,
  add column if not exists last_placement_error text;

comment on column learn.subjects.placement_attempts is
  'Failed placement attempts by the hourly sweep; at three the sweep leaves the subject alone until its name or note changes.';
comment on column learn.subjects.last_placement_error is
  'What the last failed placement attempt said; null once the subject is placed or its name or note changes.';

create or replace function learn.reset_placement_attempts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.name is distinct from old.name or new.note is distinct from old.note then
    new.placement_attempts := 0;
    new.last_placement_error := null;
  end if;
  return new;
end;
$$;

create or replace trigger subjects_reset_placement_attempts
  before update of name, note on learn.subjects
  for each row execute function learn.reset_placement_attempts();

-- Calendar invites as the source of interview times.
--
-- Until now an interview row got its time from a language model reading prose:
-- "Thursday at 2" has no year and no zone, and a reschedule reads exactly like
-- the original invite, so the same interview could land on the board twice
-- while the real one sat at the wrong hour. The same messages carry a
-- text/calendar part that states the instant, the duration, the attendees and
-- the video link outright, and says whether it is a booking, a change, or a
-- cancellation.
--
-- ics_uid is what makes an update an update: it is stable across reschedules,
-- so the second invite edits the row the first one created rather than adding
-- a second interview. ics_sequence is the organiser's revision counter, and it
-- exists so a re-delivered older invite cannot overwrite a newer one -- mail
-- arrives out of order often enough that this is not hypothetical.
--
-- The body of the invite is not stored, which is the same rule the message
-- bodies follow. What is kept is the appointment: when, how long, where, and
-- the link to join.

set search_path = job_search, extensions;

alter table interviews
  add column if not exists ics_uid text,
  add column if not exists ics_sequence int,
  -- Zoom / Meet / Teams, from the invite's conference property or its body.
  add column if not exists meeting_url text,
  -- Free text exactly as the organiser wrote it: a street address for an
  -- onsite, a room name, or the name of a video product.
  add column if not exists location text,
  -- The zone the organiser scheduled in. Rendering uses the profile timezone;
  -- this is here so "9am their time" stays answerable.
  add column if not exists time_zone text;

-- One interview per invite. Partial, because interviews entered by hand and
-- interviews inferred from prose have no uid and must not collide with each
-- other.
create unique index if not exists interviews_ics_uid_key
  on interviews (application_id, ics_uid)
  where ics_uid is not null;

comment on column interviews.ics_uid is
  'UID from the calendar invite. Stable across reschedules, so a later invite updates this row rather than creating a second interview.';
comment on column interviews.ics_sequence is
  'SEQUENCE from the invite. A lower value than the stored one means the mail arrived out of order and is ignored.';

-- Interviews booked four hours early by an Outlook invite.
--
-- Outlook writes `TZID="Eastern Standard Time"` -- a Windows zone name, not an
-- IANA one. `Intl.DateTimeFormat` throws on those, so the ICS parser's
-- unknown-zone fallback took the wall clock and stamped it as UTC: a superday
-- at 10:30am Eastern was stored as 10:30Z and read back as 6:30am. The parser
-- now translates Windows names before it asks Intl (lib/jobs/calendar/
-- windows-zones.ts); this repairs what it already wrote.
--
-- The affected rows identify themselves. `applyInvite` stores the invite's
-- TZID verbatim in `time_zone`, so an interview carrying a Windows name is
-- exactly one that went through the fallback, and one carrying an IANA name
-- was parsed correctly and must not be touched. Rewriting `time_zone` to the
-- IANA name as part of the same statement is what makes this safe to run
-- twice: after it, nothing matches.
--
-- Note the trap in the names: "Eastern Standard Time" is Windows' label for
-- the Eastern zone year-round, daylight saving included. Converting through
-- `America/New_York` gets EDT and EST each right for their own dates; a fixed
-- -05:00 would be an hour wrong for most of the year.

set search_path = job_search, extensions;

begin;

update interviews i
set
  -- The stored value's wall clock, reinterpreted in the zone it was always in.
  scheduled_at = ((i.scheduled_at at time zone 'UTC') at time zone z.iana),
  time_zone = z.iana
from (
  values
    ('Eastern Standard Time', 'America/New_York'),
    ('Central Standard Time', 'America/Chicago'),
    ('Mountain Standard Time', 'America/Denver'),
    ('US Mountain Standard Time', 'America/Phoenix'),
    ('Pacific Standard Time', 'America/Los_Angeles'),
    ('Atlantic Standard Time', 'America/Halifax'),
    ('GMT Standard Time', 'Europe/London'),
    ('W. Europe Standard Time', 'Europe/Berlin'),
    ('W Europe Standard Time', 'Europe/Berlin'),
    ('Romance Standard Time', 'Europe/Paris'),
    ('Central Europe Standard Time', 'Europe/Budapest'),
    ('Central European Standard Time', 'Europe/Warsaw'),
    ('India Standard Time', 'Asia/Kolkata'),
    ('China Standard Time', 'Asia/Shanghai'),
    ('Tokyo Standard Time', 'Asia/Tokyo'),
    ('Korea Standard Time', 'Asia/Seoul'),
    ('Singapore Standard Time', 'Asia/Singapore'),
    ('AUS Eastern Standard Time', 'Australia/Sydney'),
    ('New Zealand Standard Time', 'Pacific/Auckland')
) as z (windows, iana)
where i.time_zone = z.windows
  and i.scheduled_at is not null;

-- ---------------------------------------------------------------------------
-- The slot the same superday lost.
--
-- Four Outlook invites arrived for 15 September; three became interviews and
-- the 10:30 one did not, so the round has read as three conversations ever
-- since. Its invite is still on the pursuit's timeline, which is where the UID
-- and the hour below come from -- this restores the row from the mail rather
-- than inventing it.
--
-- Keyed on that UID and guarded by `not exists`, so it inserts once and does
-- nothing on a second run or if the invite is ever reprocessed.
-- ---------------------------------------------------------------------------
insert into interviews (
  user_id, application_id, group_id, round, kind, scheduled_at, time_known,
  duration_minutes, format, status, ics_uid, ics_sequence, time_zone
)
select
  peer.user_id,
  peer.application_id,
  peer.group_id,
  1,
  peer.kind,
  timestamptz '2026-09-15 10:30:00 America/New_York',
  true,
  60,
  'video',
  'scheduled',
  '040000008200E00074C5B7101A82E00800000000DAD7DEC50B3BDD010000000000000000100000007E9C7FE20EB1DB4D87BB3F4ABE0F5C51',
  1,
  'America/New_York'
from interviews peer
where peer.ics_uid =
  '040000008200E00074C5B7101A82E008000000001E20ABC70B3BDD01000000000000000010000000FBA92A81CD4A68409EAFC452543460CA'
  and not exists (
    select 1 from interviews existing
    where existing.ics_uid =
      '040000008200E00074C5B7101A82E00800000000DAD7DEC50B3BDD010000000000000000100000007E9C7FE20EB1DB4D87BB3F4ABE0F5C51'
  );

-- Who was in that room, per the covering mail that listed the panel.
insert into interview_participants (interview_id, contact_id, role)
select i.id, c.id, 'interviewer'
from interviews i
join contacts c on c.user_id = i.user_id and c.full_name = 'Ryan Kleiner'
where i.ics_uid =
  '040000008200E00074C5B7101A82E00800000000DAD7DEC50B3BDD010000000000000000100000007E9C7FE20EB1DB4D87BB3F4ABE0F5C51'
on conflict do nothing;

-- The day now reads in the order it happens. Only this round is renumbered:
-- the pursuit's wider round numbering is a separate question, and widening
-- the repair to answer it here would change rows this note never touched.
update interviews i
set round = ordered.position
from (
  select
    id,
    row_number() over (order by scheduled_at) as position,
    group_id
  from interviews
  where group_id = 'ea3c14d4-7005-4904-b6b2-90335261a8ea'
) as ordered
where i.id = ordered.id
  and i.round is distinct from ordered.position;

commit;

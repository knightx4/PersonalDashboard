-- The one person an application is followed up with, and why them.
--
-- Once an application goes in, Dash names someone to tell: the referrer, the
-- recruiter who wrote about it, someone the person knows there, or the
-- hiring manager it found on the web (lib/jobs/followup/person.ts). The note
-- itself is a draft touch on that contact with this application's id
-- (contact_touches.draft), so it is edited, copied and marked sent the way
-- every other draft is.
--
--   follow_up_contact_id  the person; cleared if the contact is deleted
--   follow_up_why         one line on why them, as the role page shows it
--   follow_up_tried_at    when Dash last looked for someone, found or not,
--                         so an application with nobody to find is not
--                         searched again every day
--
-- Schema only.

alter table job_search.applications
  add column if not exists follow_up_contact_id uuid references job_search.contacts (id) on delete set null,
  add column if not exists follow_up_why text,
  add column if not exists follow_up_tried_at timestamptz;

create index if not exists applications_follow_up_contact_idx
  on job_search.applications (follow_up_contact_id)
  where follow_up_contact_id is not null;

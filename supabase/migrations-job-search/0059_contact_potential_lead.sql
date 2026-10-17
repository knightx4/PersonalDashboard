-- A contact marked as a potential lead: someone who could lead to a job and
-- is worth reaching out to. Set on the contact's page, or by an agent that
-- finds people (Dash's change_contact), and filtered on in the Contacts list.
alter table job_search.contacts
  add column if not exists potential_lead boolean not null default false;

create index if not exists contacts_user_potential_lead_idx
  on job_search.contacts (user_id)
  where potential_lead;

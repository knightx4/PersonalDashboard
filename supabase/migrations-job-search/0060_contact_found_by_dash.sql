-- A contact Dash found, rather than one the person added or one that came in
-- by mail: set by an agent that searches for people (Dash's change_contact),
-- shown on the contact's page and filtered on in the Contacts list.
alter table job_search.contacts
  add column if not exists found_by_dash boolean not null default false;

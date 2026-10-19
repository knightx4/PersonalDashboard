-- Mark the contacts that came from a LinkedIn connection (plan #2432.13).
--
-- #2432.3 decided every LinkedIn connection becomes a contact, with a separate
-- field so the Contacts list can leave them out. The flag records where the
-- contact came from, so it stays true once set. Schema only: the default is
-- false, so every existing row reads as not from LinkedIn and no row is
-- rewritten by hand.

alter table job_search.contacts
  add column if not exists linkedin_connection boolean not null default false;

comment on column job_search.contacts.linkedin_connection is
  'True for a contact made from a LinkedIn connection (set by the LinkedIn import). Never cleared by later messages.';

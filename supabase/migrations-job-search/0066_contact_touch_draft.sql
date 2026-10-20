-- A message to a contact kept as a draft (plan #2457.1).
--
-- A draft is a touch the person has written and not sent. It holds sent_at at
-- its creation time until it is marked sent, which overwrites it. Every
-- existing row is a send, so the flag defaults to false. Schema only.

alter table job_search.contact_touches
  add column if not exists draft boolean not null default false;

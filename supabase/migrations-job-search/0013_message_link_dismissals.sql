-- "Not a match" memory for the mail-linking suggester on the role page.
--
-- The suggester offers unlinked mail whose subject or sender mentions the
-- company name as a candidate to link to a pursuit. Approving one is the
-- existing manual link path; declining one needs to stick, or the same
-- message would keep resurfacing on every visit until it is linked
-- somewhere else or dismissed app-wide as not relevant.

set search_path = job_search, extensions;

create table message_link_dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references applications (id) on delete cascade,
  message_id uuid not null references core.ingested_messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (application_id, message_id)
);

create index message_link_dismissals_application_idx
  on message_link_dismissals (application_id);

alter table message_link_dismissals enable row level security;

create policy message_link_dismissals_select on message_link_dismissals for select to authenticated
  using (user_id = (select auth.uid()));
create policy message_link_dismissals_insert on message_link_dismissals for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy message_link_dismissals_delete on message_link_dismissals for delete to authenticated
  using (user_id = (select auth.uid()));

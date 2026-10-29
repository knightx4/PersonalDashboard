-- The people an application is followed up with: as many as the person
-- wants, each with why them and who chose them.
--
-- Migration 0074 kept one person on the application itself
-- (follow_up_contact_id, follow_up_why). The person asked to reach out to
-- several people about one application, so the choice moves to a row per
-- person. follow_up_tried_at stays on the application: it says when Dash
-- last looked for anyone. The note to each person is still a draft touch on
-- that contact carrying the application's id (lib/jobs/followup).
--
--   why         one line on why this person, as the role page shows it
--   chosen_by   'dash' when Dash named them, 'person' when the person did
--
-- follow_up_contact_id and follow_up_why are no longer read once the code
-- that reads this table is deployed; they are left in place so the
-- deployed code keeps working until then, and can be dropped after.
--
-- The rows already named are copied over for the owner's account, the only
-- one that has used it.

set search_path = job_search, extensions;

create table if not exists application_outreach (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null references applications (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  why text,
  chosen_by text not null default 'dash',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_outreach_chosen_by_ck check (chosen_by in ('dash', 'person')),
  constraint application_outreach_one_per_person unique (application_id, contact_id)
);

create index if not exists application_outreach_user_idx on application_outreach (user_id);
create index if not exists application_outreach_contact_idx on application_outreach (contact_id);

create trigger application_outreach_touch_updated_at before update on application_outreach
  for each row execute function job_search.touch_updated_at();

create trigger application_outreach_same_owner before insert or update on application_outreach
  for each row execute function job_search.assert_parents_same_owner();

alter table application_outreach enable row level security;

create policy application_outreach_select on application_outreach for select to authenticated
  using (user_id = (select auth.uid()));
create policy application_outreach_insert on application_outreach for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy application_outreach_update on application_outreach for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy application_outreach_delete on application_outreach for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on application_outreach to authenticated;
grant all on application_outreach to service_role;
revoke all on application_outreach from anon;

insert into application_outreach (user_id, application_id, contact_id, why, chosen_by)
select a.user_id, a.id, a.follow_up_contact_id, a.follow_up_why,
       case when a.follow_up_why = 'You chose them.' then 'person' else 'dash' end
from applications a
where a.user_id = null::uuid /* the owner's id when this ran on the live database; a new install has no owner yet */
  and a.follow_up_contact_id is not null
on conflict (application_id, contact_id) do nothing;

-- A user-editable list of senders whose mail should never become a pursuit.
--
-- Indeed is excluded outright in code, because its volume of suggested-job
-- mail is large enough to be worth never fetching at all. LinkedIn cannot be
-- excluded the same way -- real recruiter InMail and "5 jobs for you" come
-- from the same domain -- and no amount of hardcoding covers every board
-- and newsletter a mailbox collects. This is the escape hatch: a sender
-- domain the user says is noise, checked alongside the built-in list.

set search_path = job_search, extensions;

create table excluded_senders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null,
  created_at timestamptz not null default now()
);

create unique index excluded_senders_user_domain_uidx
  on excluded_senders (user_id, lower(domain));

alter table excluded_senders enable row level security;

create policy excluded_senders_select on excluded_senders for select to authenticated
  using (user_id = (select auth.uid()));
create policy excluded_senders_insert on excluded_senders for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy excluded_senders_delete on excluded_senders for delete to authenticated
  using (user_id = (select auth.uid()));

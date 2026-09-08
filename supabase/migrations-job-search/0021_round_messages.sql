-- The mail a round came out of, kept on the round.
--
-- "Add from email" already existed on the form that makes an interview, but it
-- only ever seeded the kind and showed the subject once: nothing was written
-- down, so the moment the form closed the connection between the round and the
-- invitation that produced it was gone. And because it lived on that form, the
-- only moment you could reach for it was while adding an interview -- a round
-- that already existed could never be told which emails it was about.
--
-- Hence a link table rather than a column. A round is regularly described by
-- more than one message: the invite, the reschedule, the "here is your panel"
-- follow-up. One column would hold the first and lose the rest.
--
-- `on delete cascade` both ways is right here. The link is not data in its own
-- right -- it says two rows that still exist belong together -- so when either
-- end goes the statement is simply no longer being made.

set search_path = job_search, extensions;

create table interview_group_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid not null references interview_groups (id) on delete cascade,
  message_id uuid not null references core.ingested_messages (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (group_id, message_id)
);

create index interview_group_messages_group_idx on interview_group_messages (group_id);
create index interview_group_messages_user_idx on interview_group_messages (user_id);

-- `group_id` is already in the parent list the shared check walks, so the
-- trigger refuses a round belonging to somebody else without any change to it.
create trigger interview_group_messages_same_owner
  before insert or update on interview_group_messages
  for each row execute function job_search.assert_parents_same_owner();

alter table interview_group_messages enable row level security;

create policy interview_group_messages_select on interview_group_messages for select to authenticated
  using (user_id = (select auth.uid()));
create policy interview_group_messages_insert on interview_group_messages for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy interview_group_messages_delete on interview_group_messages for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on interview_group_messages to authenticated;
grant all on interview_group_messages to service_role;

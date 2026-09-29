-- An email waiting on the person's answer becomes a Todo task, once per
-- thread (plan #1180, under #1174).
--
-- The mailroom (lib/core/mailroom) puts every email in a pile with Jev and
-- stores it in core.mail_piles. The Todo side reads the needs_reply pile and
-- files a task for each thread Jev is sure about. todo.reply_threads records
-- every thread it has judged, with or without a task, so a thread is filed at
-- most once however many of its messages arrive, and a task the person
-- deletes or finishes does not come back.
--
-- The task copies what it needs (who wrote and the subject into the title, a
-- Gmail link into the body), so the scrub of unclaimed mail can still wipe
-- the message row afterwards. Nothing here changes the scrub.
--
-- In this folder because it points at todo.tasks and at core, and the todo
-- schema is built last (scripts/db-reset.sh).
--
-- Bookkeeping, so not a source for Goals (lib/todo/sources.ts). The tasks it
-- files are todo.tasks rows, which are.

set search_path = todo, public, extensions;

create table if not exists todo.reply_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email_account_id uuid not null references core.email_accounts (id) on delete cascade,
  -- Gmail's thread id, or the message's own id when it has none.
  thread_id text not null,
  message_id uuid references core.ingested_messages (id) on delete set null,
  -- Null when the thread was judged and no task was filed (an automated
  -- sender, the person's own address), or when the task was deleted.
  task_id uuid references todo.tasks (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint reply_threads_thread_ck check (length(thread_id) between 1 and 200),
  constraint reply_threads_thread_key unique (email_account_id, thread_id)
);

create index if not exists reply_threads_user_idx on todo.reply_threads (user_id);
create index if not exists reply_threads_task_idx on todo.reply_threads (task_id)
  where task_id is not null;
create index if not exists reply_threads_message_idx on todo.reply_threads (message_id)
  where message_id is not null;

alter table todo.reply_threads enable row level security;

drop policy if exists reply_threads_select on todo.reply_threads;
create policy reply_threads_select on todo.reply_threads for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on todo.reply_threads from public, anon, authenticated;
grant select on todo.reply_threads to authenticated;
grant select, insert, update, delete on todo.reply_threads to service_role;

comment on table todo.reply_threads is
  'Each email thread judged for a reply task, and the task filed for it, if any (plan #1180).';

-- The newest message of each thread Jev is sure needs a reply, received since
-- p_since, still carrying its sender and subject, and not judged yet.
create or replace function todo.reply_candidates(
  p_user_id uuid,
  p_floor real,
  p_since timestamptz,
  p_limit integer
)
returns table (
  message_id uuid,
  account_email text,
  thread_id text,
  received_at timestamptz,
  from_address text,
  reply_to_address text,
  subject text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.email_address, c.thread_key, c.received_at,
         c.from_address, c.reply_to_address, c.subject
  from (
    select distinct on (m.email_account_id, coalesce(m.thread_id, m.provider_message_id))
           m.id, a.email_address, m.email_account_id,
           coalesce(m.thread_id, m.provider_message_id) as thread_key,
           m.received_at, m.from_address, m.reply_to_address, m.subject
    from core.mail_piles p
    join core.ingested_messages m on m.id = p.id
    join core.email_accounts a on a.id = m.email_account_id
    where p.user_id = p_user_id
      and a.user_id = p_user_id
      and p.pile = 'needs_reply'
      and p.confidence >= p_floor
      and m.received_at >= p_since
      and m.scrubbed_at is null
      and (m.from_address is not null or m.subject is not null)
    order by m.email_account_id, coalesce(m.thread_id, m.provider_message_id),
             m.received_at desc
  ) c
  where not exists (
    select 1 from todo.reply_threads r
    where r.email_account_id = c.email_account_id and r.thread_id = c.thread_key
  )
  order by c.received_at desc
  limit greatest(0, least(p_limit, 100));
$$;

-- Record the message's thread as judged and, when p_title is given, file the
-- task. Returns the new task's id, or null when the thread was already judged,
-- the message is not the person's, or no task was asked for. The unique key on
-- the thread is what keeps two syncs racing from filing it twice.
create or replace function todo.file_reply_task(
  p_user_id uuid,
  p_message_id uuid,
  p_title text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_thread text;
  v_row uuid;
  v_task uuid;
begin
  select m.email_account_id, coalesce(m.thread_id, m.provider_message_id)
    into v_account, v_thread
  from core.ingested_messages m
  join core.email_accounts a on a.id = m.email_account_id
  where m.id = p_message_id and a.user_id = p_user_id;
  if v_account is null then
    return null;
  end if;

  insert into todo.reply_threads (user_id, email_account_id, thread_id, message_id)
  values (p_user_id, v_account, v_thread, p_message_id)
  on conflict (email_account_id, thread_id) do nothing
  returning id into v_row;
  if v_row is null or p_title is null then
    return null;
  end if;

  insert into todo.tasks (user_id, title, body)
  values (p_user_id, p_title, p_body)
  returning id into v_task;
  update todo.reply_threads set task_id = v_task where id = v_row;
  return v_task;
end;
$$;

revoke all on function todo.reply_candidates(uuid, real, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function todo.file_reply_task(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function todo.reply_candidates(uuid, real, timestamptz, integer) to service_role;
grant execute on function todo.file_reply_task(uuid, uuid, text, text) to service_role;

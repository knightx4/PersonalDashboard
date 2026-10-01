-- ---------------------------------------------------------------------------
-- 0016 -- attachments: files and emails kept on a task or a calendar event.
--
-- A ticket, a booking confirmation, a photo of a form: each belongs with the
-- thing it is for. This gives a task and an event somewhere to hold them.
--
-- Two kinds of attachment, one table.
--
--   file   something the person uploaded: a PDF, an image, a document. The
--          bytes are in the todo-attachments bucket at storage_path.
--   email  a message from the person's connected Gmail, kept as a snapshot of
--          who sent it, when, the subject and its readable text, with the link
--          that opens it in Gmail. The files attached to the message are
--          copied into the bucket as 'file' rows of their own, pointing back
--          at the email through from_email_id, so a ticket PDF opens from the
--          event without a trip to Gmail.
--
-- The email is kept only because the person attached it, which is the one
-- case lib/inbox/read-mail.ts, which stores nothing, does not cover.
--
-- An attachment is its own row and a link puts it on a task or an event, so
-- one email can sit on the event and on the todo to book the trip. Removing
-- the last link removes the attachment and its file (the app does that;
-- storage does not cascade with rows).
-- ---------------------------------------------------------------------------

set search_path = todo, public, extensions;

create type todo.attachment_kind as enum ('file', 'email');

create table todo.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind todo.attachment_kind not null,

  -- What it is for. Lets the event say "Tickets" without guessing from a name.
  role text not null default 'other',

  -- A file's own name, or an email's subject.
  name text not null,
  note text,

  -- file
  mime_type text,
  size_bytes bigint,
  storage_path text,
  -- The email a file came out of, when it did.
  from_email_id uuid references todo.attachments (id) on delete set null,

  -- email
  email_account_id uuid,
  email_message_id text,
  email_from text,
  email_sent_at timestamptz,
  email_text text,
  email_gmail_url text,

  created_at timestamptz not null default now(),

  constraint attachments_role_ck check (
    role in ('ticket', 'receipt', 'confirmation', 'document', 'photo', 'other')
  ),
  constraint attachments_name_ck check (btrim(name) <> '' and length(name) <= 500),
  constraint attachments_note_ck check (note is null or length(note) <= 2000),
  constraint attachments_size_ck check (size_bytes is null or size_bytes >= 0),
  constraint attachments_file_ck check (
    kind <> 'file' or (storage_path is not null and mime_type is not null and size_bytes is not null)
  ),
  constraint attachments_email_ck check (
    kind <> 'email' or (email_account_id is not null and email_message_id is not null)
  )
);

-- One row per message, so attaching it to a second place is a link and not a
-- second copy.
create unique index attachments_email_key
  on todo.attachments (user_id, email_account_id, email_message_id)
  where kind = 'email';
create index attachments_user_idx on todo.attachments (user_id, created_at desc);
create index attachments_from_email_idx on todo.attachments (from_email_id)
  where from_email_id is not null;

-- ---------------------------------------------------------------------------
-- Links. Exactly one target, as task_links has exactly one.
-- ---------------------------------------------------------------------------
create table todo.attachment_links (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references todo.attachments (id) on delete cascade,
  task_id uuid references todo.tasks (id) on delete cascade,
  event_id uuid references todo.events (id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint attachment_links_one_target_ck check (num_nonnulls(task_id, event_id) = 1)
);

create unique index attachment_links_task_key on todo.attachment_links (attachment_id, task_id)
  where task_id is not null;
create unique index attachment_links_event_key on todo.attachment_links (attachment_id, event_id)
  where event_id is not null;
create index attachment_links_task_idx on todo.attachment_links (task_id) where task_id is not null;
create index attachment_links_event_idx on todo.attachment_links (event_id)
  where event_id is not null;

-- ---------------------------------------------------------------------------
-- Ownership. A foreign key is satisfied by any row, including another
-- account's, so the database checks that the attachment and what it is put on
-- belong to the same person, as todo.task_links does (0001).
-- ---------------------------------------------------------------------------
create or replace function todo.attachment_link_is_owned()
returns trigger
language plpgsql
security definer
set search_path = todo, public
as $$
declare
  attachment_owner uuid;
  target_owner uuid;
begin
  if num_nonnulls(new.task_id, new.event_id) <> 1 then
    return new;
  end if;

  select user_id into attachment_owner from todo.attachments where id = new.attachment_id;
  select case
    when new.task_id is not null then (select user_id from todo.tasks where id = new.task_id)
    else (select user_id from todo.events where id = new.event_id)
  end into target_owner;

  if attachment_owner is null or target_owner is null or attachment_owner <> target_owner then
    raise exception 'an attachment can only be put on something its owner owns';
  end if;

  return new;
end;
$$;

create trigger attachment_links_is_owned
  before insert or update on todo.attachment_links
  for each row execute function todo.attachment_link_is_owned();

revoke all on function todo.attachment_link_is_owned() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS, and the grants a table added after 0001 does not inherit.
-- ---------------------------------------------------------------------------
alter table todo.attachments enable row level security;
alter table todo.attachment_links enable row level security;

create policy attachments_all on todo.attachments for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy attachment_links_all on todo.attachment_links for all to authenticated
  using (exists (
    select 1 from todo.attachments a
    where a.id = attachment_links.attachment_id and a.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from todo.attachments a
    where a.id = attachment_links.attachment_id and a.user_id = (select auth.uid())
  ));

grant select, insert, update, delete on todo.attachments, todo.attachment_links
  to authenticated, service_role;
revoke all on todo.attachments, todo.attachment_links from anon;

-- ---------------------------------------------------------------------------
-- The bucket.
--
--   path     <user id>/<attachment id>
--   read     your own folder
--   write    your own folder (a file goes straight from the browser to the
--            bucket on a signed upload URL, so a large one never passes
--            through a server action)
--   delete   your own folder
--
-- Private; a file opens through a short-lived signed URL. SVG and HTML are
-- left out because a browser runs the script inside them.
--
-- Skipped where there is no storage schema, which is the local test database.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'no storage schema here -- skipping the todo-attachments bucket. Expected on the local test database.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'todo-attachments',
    'todo-attachments',
    false,
    26214400,
    array[
      'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
      'application/pdf',
      'text/plain', 'text/csv', 'text/calendar',
      'application/vnd.apple.pkpass',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg',
      'video/mp4', 'video/quicktime'
    ]
  )
  on conflict (id) do nothing;

  execute $p$
    create policy todo_attachments_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'todo-attachments'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;
  execute $p$
    create policy todo_attachments_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'todo-attachments'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;
  execute $p$
    create policy todo_attachments_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'todo-attachments'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;
end;
$$;

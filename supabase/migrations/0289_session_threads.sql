-- Conversations with a Claude Code session, kept in the app (plan #2789.4,
-- under feature #2789).
--
-- From Chat or a project page the person starts a thread with a session that
-- works on one repository: a project of theirs (public.dev_projects) or this
-- app. Both sides write messages into the thread; a session writes its
-- replies, mockups, questions and status lines through the connector
-- (#2789.5), and the person answers a question by pressing one of its options.
--
-- 1. core.session_threads
--
--   title        what the thread is about, as the list shows it.
--   project_id   the dev_projects id the session works on, or null for this
--                app. Deleting a project that still has threads is refused;
--                projects are archived, not deleted.
--   session_id   the Claude Code session's id once it has started, null while
--                queued. One thread per session.
--   state        queued    waiting for a session to start
--                working   the session is working
--                waiting   the session is waiting on the person
--                idle      the session has stopped and can be woken
--                ended     the thread is over
--
-- 2. core.session_messages
--
--   author           'person' or 'session'.
--   kind             text      a message
--                    mockup    a picture of a screen, at artifact_url
--                    question  a question with options to press
--                    status    a line on what the session is doing
--   body             the words. May be blank when a link or a file carries
--                    the message.
--   options          a question's options, a JSON array of one to ten strings.
--   artifact_url     a link to a published artifact (a mockup, a page).
--   attachment_path  a file the person attached, in the attachments bucket
--                    (migration 0193) under their own folder. A session reads
--                    it through a short signed link.
--   delivered_at     when the message reached the session; null on a person's
--                    message the session has not been given yet.
--   answer           the option the person chose, on a question.
--   answered_at      when they chose it.
--
-- Row-level security gives each account its own rows. A message names its
-- thread together with the account, so a message cannot hang from somebody
-- else's thread.
--
-- Files go in the existing attachments bucket rather than a new one: it is
-- private, foldered by account, cleared when the account is deleted, and
-- /attachments signs links to it already.

set search_path = core, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Threads.
-- ---------------------------------------------------------------------------
create table core.session_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  title text not null,
  project_id text,
  session_id text,
  state text not null default 'queued',

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  constraint session_threads_id_user_key unique (id, user_id),
  constraint session_threads_project_fk foreign key (user_id, project_id)
    references public.dev_projects (user_id, id),
  constraint session_threads_title_ck
    check (btrim(title) <> '' and char_length(title) <= 200),
  constraint session_threads_session_id_ck
    check (session_id is null or (btrim(session_id) <> '' and char_length(session_id) <= 200)),
  constraint session_threads_state_ck
    check (state in ('queued', 'working', 'waiting', 'idle', 'ended'))
);

-- One thread per session, and the lookup a session's reply makes.
create unique index session_threads_session_key on core.session_threads (session_id)
  where session_id is not null;
-- The thread list, latest first.
create index session_threads_user_idx on core.session_threads (user_id, updated_at desc);
-- A project page's threads.
create index session_threads_project_idx on core.session_threads (user_id, project_id)
  where project_id is not null;

create trigger session_threads_touch_updated_at
  before update on core.session_threads
  for each row execute function public.touch_updated_at();

alter table core.session_threads enable row level security;

create policy session_threads_all on core.session_threads for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on core.session_threads from anon;
grant select, insert, update, delete on core.session_threads to authenticated;
grant all on core.session_threads to service_role;

comment on table core.session_threads is
  'A conversation with a Claude Code session on one repository: a dev_projects project, or this app when project_id is null (plan #2789.4).';

-- ---------------------------------------------------------------------------
-- 2. Messages.
-- ---------------------------------------------------------------------------
create table core.session_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id uuid not null,

  author text not null,
  kind text not null default 'text',
  body text not null default '',
  options jsonb,
  artifact_url text,
  attachment_path text,
  delivered_at timestamptz,
  answer text,
  answered_at timestamptz,

  created_at timestamptz not null default clock_timestamp(),

  constraint session_messages_thread_fk foreign key (thread_id, user_id)
    references core.session_threads (id, user_id) on delete cascade,
  constraint session_messages_author_ck check (author in ('person', 'session')),
  constraint session_messages_kind_ck check (kind in ('text', 'mockup', 'question', 'status')),
  constraint session_messages_body_ck check (char_length(body) <= 40000),
  -- Something to show: words, a link or a file.
  constraint session_messages_not_empty_ck
    check (btrim(body) <> '' or artifact_url is not null or attachment_path is not null),
  constraint session_messages_mockup_ck check (kind <> 'mockup' or artifact_url is not null),
  constraint session_messages_options_ck check (
    options is null or (
      kind = 'question'
      and jsonb_typeof(options) = 'array'
      and jsonb_array_length(options) between 1 and 10
    )
  ),
  constraint session_messages_artifact_url_ck
    check (artifact_url is null or (artifact_url ~ '^https://' and char_length(artifact_url) <= 2000)),
  constraint session_messages_attachment_path_ck check (
    attachment_path is null
    or (attachment_path like user_id::text || '/%' and char_length(attachment_path) <= 200)
  ),
  constraint session_messages_answer_ck check (
    answer is null or (kind = 'question' and btrim(answer) <> '' and char_length(answer) <= 2000)
  ),
  constraint session_messages_answered_ck check ((answer is null) = (answered_at is null))
);

-- A thread's messages in order.
create index session_messages_thread_idx on core.session_messages (thread_id, created_at);
-- The person's messages the session has not been given yet.
create index session_messages_undelivered_idx on core.session_messages (thread_id, created_at)
  where author = 'person' and delivered_at is null;
create index session_messages_user_idx on core.session_messages (user_id);

alter table core.session_messages enable row level security;

create policy session_messages_all on core.session_messages for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on core.session_messages from anon;
grant select, insert, update, delete on core.session_messages to authenticated;
grant all on core.session_messages to service_role;

comment on table core.session_messages is
  'What the person and a Claude Code session wrote in a session thread, with a question''s options and the answer chosen (plan #2789.4).';

notify pgrst, 'reload schema';

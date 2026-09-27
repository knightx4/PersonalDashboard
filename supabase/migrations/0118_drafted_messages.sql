-- Follow-ups and return requests, written and waiting (plan #1129).
--
-- Each morning, before the brief, the hourly day-brief run looks for two
-- things: a job application that has gone quiet for longer than that company
-- usually takes to reply, and an item marked to go back whose return window
-- closes within three days. For each it has Sonnet write the message
-- (lib/drafts/model.ts) and stores it here. The agenda shows it with a link
-- that opens Gmail's compose window with the recipient, subject and text in
-- place (the answer to #1128: the app keeps read-only mail access). A draft
-- nobody acts on stops showing three days after it appeared.
--
-- Columns
--
--   kind          'follow_up' for an application, 'return_request' for an order
--   about_id      the application's id (job_search.applications) or the
--                 order's (public.orders); no foreign key, since those live
--                 in other schemas
--   basis         what made it due, so the same quiet stretch or the same
--                 return window is drafted once: the time of the last word
--                 on the application, or the order's return deadline
--   about_label   the company and role, or the shop and order number, as the
--                 agenda names it
--   to_address    who it goes to: the last person who wrote about it, unless
--                 that was a no-reply address, in which case null and the
--                 compose window opens with the recipient empty
--   from_inbox    the connected mailbox the thread arrived in, so Gmail opens
--                 in that account
--   subject, body the message
--   reason        why it is due, one line, shown beside it on the agenda
--   model         the model that wrote it; null for the plain fallback written
--                 when there was no model to ask
--   show_on       the day it appears on the agenda, in the person's zone
--   expires_at    when it stops showing if nobody acted on it
--   done_at       marked sent; dismissed_at: "Not this one"
--
-- Derived, so not a source for Goals (lib/core/sources.ts). The run writes
-- with the service role. The person reads their own rows and may mark one
-- sent, dismiss it or put it off, which is all the agenda's buttons do.

set search_path = core, public, extensions;

create table if not exists core.drafted_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  about_id uuid not null,
  basis text not null,
  about_label text not null,
  to_address text,
  from_inbox text,
  subject text not null,
  body text not null,
  reason text,
  model text,
  show_on date not null,
  expires_at timestamptz not null,
  done_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint drafted_messages_kind_ck check (kind in ('follow_up', 'return_request')),
  constraint drafted_messages_basis_ck check (btrim(basis) <> '' and length(basis) <= 100),
  constraint drafted_messages_label_ck check (btrim(about_label) <> '' and length(about_label) <= 300),
  constraint drafted_messages_subject_ck check (btrim(subject) <> '' and length(subject) <= 300),
  constraint drafted_messages_body_ck check (btrim(body) <> '' and length(body) <= 4000),
  constraint drafted_messages_reason_ck check (reason is null or length(reason) <= 300),
  constraint drafted_messages_address_ck check (
    (to_address is null or length(to_address) <= 320)
    and (from_inbox is null or length(from_inbox) <= 320)
  )
);

-- One draft for each quiet stretch or return window.
create unique index if not exists drafted_messages_basis_uq
  on core.drafted_messages (user_id, kind, about_id, basis);

-- What the agenda reads: the person's drafts still waiting.
create index if not exists drafted_messages_waiting_idx
  on core.drafted_messages (user_id, expires_at)
  where done_at is null and dismissed_at is null;

alter table core.drafted_messages enable row level security;

drop policy if exists drafted_messages_select on core.drafted_messages;
create policy drafted_messages_select on core.drafted_messages for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists drafted_messages_update on core.drafted_messages;
create policy drafted_messages_update on core.drafted_messages for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on core.drafted_messages from public, anon, authenticated;
grant select on core.drafted_messages to authenticated;
grant update (done_at, dismissed_at, show_on, expires_at) on core.drafted_messages to authenticated;
grant select, insert, update, delete on core.drafted_messages to service_role;

comment on table core.drafted_messages is
  'Follow-ups and return requests Dash wrote, waiting on the agenda to be sent from Gmail (plan #1129).';

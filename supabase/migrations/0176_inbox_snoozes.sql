-- Inbox snoozes (plan #1842).
--
-- An ask in the Dev or Goals inbox can be put aside until a later day. The
-- inboxes are worked out fresh on every visit, so this is the only place that
-- remembers it. A snooze is keyed by the row it hides, not by the ask:
--
--   ref             the row, as schema.table:id ('public.plan_items:<id>',
--                   'goals.items:<id>' or 'public.raised_items:<id>').
--   snoozed_until   when the row comes back.
--   row_updated_at  the row's own change stamp when it was snoozed. A row
--                   whose stamp has moved since is a different ask, and the
--                   snooze no longer hides it (lib/core/inbox-snoozes.ts).

set search_path = core, public, extensions;

create table core.inbox_snoozes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ref text not null,
  snoozed_until timestamptz not null,
  row_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint inbox_snoozes_ref_ck check (ref ~ '^[a-z_]+\.[a-z_]+:[0-9a-f-]{36}$'),
  constraint inbox_snoozes_user_ref_key unique (user_id, ref)
);

alter table core.inbox_snoozes enable row level security;

create policy inbox_snoozes_all on core.inbox_snoozes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on core.inbox_snoozes from anon;
grant select, insert, update, delete on core.inbox_snoozes to authenticated, service_role;

comment on table core.inbox_snoozes is
  'An inbox row put aside until a later day, keyed by the row it hides; cleared in effect when the row changes (plan #1842).';

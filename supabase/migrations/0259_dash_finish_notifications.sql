-- When Dash last told the person it had finished work (plan #2389.1).
--
-- A phone notification goes out when Dash has no run in progress and has
-- finished something since the last one. This row is where the app remembers
-- that, one per person:
--
--   announced_through  the time up to which finished work has been announced;
--                      null until the first notification.
--   enabled            whether the person wants to be told (the switch on the
--                      account page).
--
-- The person reads and changes their own row; the notifying job uses the
-- service role.

set search_path = core, public, extensions;

create table public.dash_finish_notifications (
  user_id uuid primary key references auth.users (id) on delete cascade,
  announced_through timestamptz,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.dash_finish_notifications enable row level security;

create policy dash_finish_notifications_all on public.dash_finish_notifications
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.dash_finish_notifications from anon;
grant select, insert, update on public.dash_finish_notifications to authenticated;
grant select, insert, update, delete on public.dash_finish_notifications to service_role;

comment on table public.dash_finish_notifications is
  'Per person: the time finished Dash work was last announced by phone notification, and whether to announce at all (plan #2389).';

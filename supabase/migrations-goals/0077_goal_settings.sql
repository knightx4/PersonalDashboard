-- Goals settings (plan #1937.10): one row per account saying whether the
-- morning and weekly goals runs start. Set from /goals/settings. No row means
-- both runs are on, which is how they behaved before the page existed.
--
-- Applied to the live project on 13 October 2026 as goals_0077_goal_settings.

create table if not exists goals.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  morning_run boolean not null default true,
  weekly_run boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table goals.settings enable row level security;

create policy settings_all on goals.settings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on goals.settings to authenticated;
grant all on goals.settings to service_role;
revoke all on table goals.settings from anon;

comment on table goals.settings is
  'One row per account: whether the morning and weekly goals runs start. '
  'Set from Goals settings; no row means both on.';

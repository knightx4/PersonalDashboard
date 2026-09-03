-- What the agenda looks at, and what feeds it.
--
-- Module settings, not account settings: every value here would be meaningless
-- with the todo module switched off, which is the line core.account_settings
-- draws in supabase/migrations/0037_account_settings.sql.
--
-- `enabled_sources` starts EMPTY, and that is the whole posture of the source
-- registry. A merged agenda that turns itself on is one that decides for you
-- what belongs on your morning; the module ships with the tasks you typed, and
-- everything else is a switch you throw.

set search_path = todo, public, extensions;

create table todo.agenda_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Which sources may run. Names, not an enum: a source that is removed from
  -- the code should leave a harmless string behind rather than an enum value
  -- nothing can drop. Unknown names are ignored on read.
  enabled_sources text[] not null default '{}',

  -- How far ahead the agenda looks. Seven days, with everything beyond it in
  -- "Later" -- a number to revisit after a real week rather than before one.
  horizon_days int not null default 7,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenda_settings_horizon_ck check (horizon_days between 1 and 90)
);

create trigger agenda_settings_touch_updated_at
  before update on todo.agenda_settings
  for each row execute function todo.touch_updated_at();

-- No trigger on auth.users. A row is created the first time someone changes a
-- setting, and its absence is a complete answer -- every default is in the
-- column definitions above, and the reader falls back to them. One more
-- function on the shared auth.users table is one more chance for the accident
-- tests/coexistence.test.ts exists to catch.

alter table todo.agenda_settings enable row level security;

create policy agenda_settings_all on todo.agenda_settings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on todo.agenda_settings from anon;
grant select, insert, update, delete on todo.agenda_settings to authenticated, service_role;

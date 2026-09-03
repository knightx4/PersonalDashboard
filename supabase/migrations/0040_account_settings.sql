-- Account settings: the things that are true about you in every workspace.
--
-- Until now there was no such place. `timezone` lived on public.profiles AND on
-- job_search.profiles -- two columns, two defaults of 'UTC', and exactly one
-- screen that edits either of them (the job side's). So the shopping half of
-- an account has been on UTC since the day it was created, silently, and
-- "today" has had two answers that were free to disagree.
--
-- That was survivable while each workspace only ever asked itself what day it
-- was. It stops being survivable the moment one page merges all of them, which
-- is what docs/TODO-SPEC.md is about, so it is fixed first.
--
-- The line drawn here, and it is the one to argue from later: **if turning a
-- module off would make the setting meaningless, it is a module setting.**
-- Timezone survives every module being off. The vault's repository does not.
--
-- `core` rather than a fifth schema: this is the definition of a fact that
-- belongs to the account and to none of the workspaces, which is what core is
-- for. It is the same argument that put ingestion here.

set search_path = core, public, extensions;

create table core.account_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,

  display_name text,
  -- An IANA name. Validated in the app, not here: Postgres will happily accept
  -- any string, and pg_timezone_names is a catalogue rather than a constraint.
  timezone text not null default 'UTC',
  display_currency text not null default 'USD',

  -- Which workspaces appear in the switcher, and which agenda sources may run.
  -- A display setting: turning a module off hides it and nothing else. No row
  -- is dropped, no link breaks, and turning it back on restores what was there.
  enabled_modules text[] not null default array['shopping', 'jobs', 'vault', 'todo'],

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint account_settings_timezone_ck check (timezone <> ''),
  constraint account_settings_currency_ck check (display_currency ~ '^[A-Z]{3}$'),
  -- An empty array would hide the whole app from itself.
  constraint account_settings_modules_ck check (cardinality(enabled_modules) > 0)
);

-- ---------------------------------------------------------------------------
-- The two profiles columns stay, and the database keeps them true.
--
-- Roughly thirty read sites across the two workspaces select
-- `profiles.timezone`, and rewriting all of them here would make a prerequisite
-- step into a refactor of two products. So this is the one writer, and a
-- trigger propagates to both mirrors.
--
-- This is derived data maintained by the database, not a second writer: the
-- copies cannot drift, because nothing but this table is written by hand. The
-- columns are retired later by moving readers over at leisure, which is a
-- change no user can see.
-- ---------------------------------------------------------------------------
create or replace function core.mirror_account_settings()
returns trigger
language plpgsql
security definer
set search_path = core, public, job_search
as $$
begin
  update public.profiles
     set timezone = new.timezone,
         display_currency = new.display_currency,
         display_name = coalesce(new.display_name, display_name)
   where id = new.user_id;

  update job_search.profiles
     set timezone = new.timezone,
         display_name = coalesce(new.display_name, display_name)
   where id = new.user_id;

  return new;
end;
$$;

alter function core.mirror_account_settings() owner to postgres;
revoke all on function core.mirror_account_settings() from public, anon, authenticated;

create trigger account_settings_mirror
  after insert or update of timezone, display_currency, display_name
  on core.account_settings
  for each row execute function core.mirror_account_settings();

-- ---------------------------------------------------------------------------
-- updated_at. core has no touch function of its own yet; this is its copy, for
-- the same reason obsidian has one -- so the schema does not depend on another
-- schema's function surviving a refactor.
-- ---------------------------------------------------------------------------
create or replace function core.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter function core.touch_updated_at() set search_path = core;
revoke all on function core.touch_updated_at() from public, anon, authenticated;

create trigger account_settings_touch_updated_at
  before update on core.account_settings
  for each row execute function core.touch_updated_at();

-- ---------------------------------------------------------------------------
-- One row per account, created by trigger, exactly as both profiles rows are.
-- ---------------------------------------------------------------------------
create or replace function core.handle_new_user_settings()
returns trigger
language plpgsql
security definer
set search_path = core, public
as $$
begin
  insert into core.account_settings (user_id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function core.handle_new_user_settings() from public, anon, authenticated;

create trigger on_auth_user_created_settings
  after insert on auth.users
  for each row execute function core.handle_new_user_settings();

-- ---------------------------------------------------------------------------
-- Backfill.
--
-- Nobody's setting may change underneath them, so the non-default value wins:
-- the job side is the only one with an edit screen, so its timezone is the one
-- a person actually chose, and public's is almost certainly the untouched
-- default. Preferring "not UTC" over either table in particular is what makes
-- that true without having to know which of them was edited.
-- ---------------------------------------------------------------------------
insert into core.account_settings (user_id, display_name, timezone, display_currency)
select
  u.id,
  coalesce(nullif(j.display_name, ''), nullif(p.display_name, '')),
  coalesce(
    nullif(j.timezone, 'UTC'),
    nullif(p.timezone, 'UTC'),
    j.timezone,
    p.timezone,
    'UTC'
  ),
  coalesce(p.display_currency, 'USD')
from auth.users u
left join public.profiles p on p.id = u.id
left join job_search.profiles j on j.id = u.id
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS. Yours and only yours, like everything else.
-- ---------------------------------------------------------------------------
alter table core.account_settings enable row level security;

create policy account_settings_select on core.account_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy account_settings_insert on core.account_settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy account_settings_update on core.account_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- No delete policy: settings go when the account does, by cascade. There is no
-- such thing as an account without them.

revoke all on core.account_settings from anon;
grant select, insert, update on core.account_settings to authenticated, service_role;

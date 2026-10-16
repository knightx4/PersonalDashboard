-- What the person wants from their posts (plan #2227.1, feature #2227).
--
-- public.post_preferences, one row per person:
--   wants        what they wrote in the box on the Posts tab, up to 2000
--                characters. The posts run reads it before drafting.
--   created_at, updated_at
--                when the row was made and when the text last changed.
--
-- The row is a setting, so it is listed as not a source in lib/dev/sources.ts.

create table public.post_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  wants text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint post_preferences_wants_ck check (char_length(wants) <= 2000)
);

create trigger post_preferences_touch_updated_at
  before update on public.post_preferences
  for each row execute function public.touch_updated_at();

alter table public.post_preferences enable row level security;

create policy post_preferences_all on public.post_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.post_preferences from anon;
grant select, insert, update, delete on public.post_preferences to authenticated;
grant all on public.post_preferences to service_role;

comment on table public.post_preferences is
  'What the person wants from their posts, written on the Posts tab and read by the posts run (plan #2227.1).';

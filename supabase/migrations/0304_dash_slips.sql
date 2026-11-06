-- Each time a chat with Dash went wrong in a way it caught itself (plan #2999).
--
-- On 5 November 2026 the Builder thread on People added plan steps with a
-- title and no detail, nine times in one day, and twice ran out of its turn
-- before adding the step at all, asking the person to text "try again".
-- add_plan_step now refuses a step whose detail is missing or thin, and one
-- whose title repeats a step added in the last half hour, and a turn that
-- reaches its limit gets one more stretch to finish. Each of those is a row
-- here, so Dev Home can count them and a session can see what keeps going
-- wrong.
--
-- core.dash_slips, one row per slip:
--   kind          'thin_step' (add_plan_step refused for a missing or short
--                 detail), 'repeated_step' (refused as a repeat of a step
--                 added minutes before), or 'out_of_budget' (the turn
--                 reached its lookup, token or time limit).
--   surface       'ask' for Ask Dash, 'people' for a People thread, 'thread'
--                 for a row's comment thread.
--   tool          the tool refused, when a tool was.
--   conversation  where it happened: 'ask:<id>' or 'people:<chat id>'; null
--                 when the caller did not say.
--   href          the page the conversation opens on, for Dev Home's link.
--   what          what was wrong, in a sentence.
--
-- Bookkeeping, append-only like core.dash_failures: the owner may read and
-- insert their own rows, nobody rewrites one. Schema only: no row is written
-- or changed here.

set search_path = core, public, extensions;

create table core.dash_slips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  kind text not null,
  surface text not null,
  tool text,
  conversation text,
  href text,
  what text not null,

  created_at timestamptz not null default clock_timestamp(),

  constraint dash_slips_kind_ck check (kind in ('thin_step', 'repeated_step', 'out_of_budget')),
  constraint dash_slips_surface_ck check (surface in ('ask', 'people', 'thread')),
  constraint dash_slips_what_ck check (btrim(what) <> '' and length(what) <= 1000),
  constraint dash_slips_href_ck check (href is null or href like '/%')
);

-- Dev Home's count of the last seven days, and the newest one's link.
create index dash_slips_user_created_idx on core.dash_slips (user_id, created_at desc);

alter table core.dash_slips enable row level security;

create policy dash_slips_select on core.dash_slips for select to authenticated
  using (user_id = (select auth.uid()));
create policy dash_slips_insert on core.dash_slips for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke all on core.dash_slips from anon, authenticated;
grant select, insert on core.dash_slips to authenticated;
grant all on core.dash_slips to service_role;

comment on table core.dash_slips is
  'Each time a chat with Dash refused a thin or repeated plan step, or a turn ran out of its budget; Dev Home counts the last seven days (plan #2999).';

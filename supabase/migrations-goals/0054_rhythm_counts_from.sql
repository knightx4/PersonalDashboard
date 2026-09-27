-- ===========================================================================
-- A rhythm can count itself from what another module records.
--
-- "Send 5 applications" a week sat on Today at 0 of 5 with a Log one button
-- in a week the job search had two applications submitted. The job search
-- already knows when each application went in, so asking the person to press
-- a button as well counts the same thing twice, and the count on the rhythm
-- is wrong whenever they forget.
--
-- Columns
--
--   items.counts_from   null        counted by hand, with Log one
--                       applications  job_search.applications submitted in
--                                   the period, by submitted_at in the
--                                   account's time zone
--
-- Only a rhythm step can carry it. A counted rhythm's open period holds the
-- source's count: a trigger on goals.periods sets it whenever an open period
-- is written, so a Log one press on it changes nothing, and a trigger on
-- job_search.applications recounts the open periods when an application's
-- submitted_at is set, changed or removed. Closed periods are left as they
-- were closed, as for every rhythm (lib/goals/rhythms.ts).
--
-- The counting runs as the owner because it reads across schemas; each read
-- and write is filtered by the row's own user_id, so it sees nothing the
-- person could not see themselves.
--
-- This file sits in migrations-goals, which is applied after job_search
-- (scripts/db-reset.sh), so the trigger it puts on job_search.applications
-- has the table to go on.
-- ===========================================================================

alter table goals.items add column counts_from text;

alter table goals.items add constraint items_counts_from_ck check (
  counts_from is null or (counts_from = 'applications' and kind = 'rhythm')
);

comment on column goals.items.counts_from is
  'Where a rhythm''s count comes from instead of Log one: applications (job_search.applications by submitted_at). Null counts by hand.';

-- How many the source holds for this person between two days, in their zone.
create function goals.counted_rhythm_count(
  p_user uuid,
  p_source text,
  p_starts date,
  p_ends date
) returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz text;
  n integer;
begin
  if p_source is distinct from 'applications' then
    return null;
  end if;
  select core.time_zone_or_utc(s.timezone) into tz
    from core.account_settings s
   where s.user_id = p_user;
  tz := coalesce(tz, 'UTC');
  select count(*)::integer into n
    from job_search.applications a
   where a.user_id = p_user
     and a.submitted_at >= (p_starts::timestamp at time zone tz)
     and a.submitted_at < (p_ends::timestamp at time zone tz);
  return n;
end;
$$;

revoke all on function goals.counted_rhythm_count(uuid, text, date, date) from public;

-- An open period of a counted rhythm holds the source's count, whatever was written.
create function goals.periods_counted() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source text;
  n integer;
begin
  if new.closed_at is not null then
    return new;
  end if;
  select i.counts_from into source
    from goals.items i
   where i.id = new.item_id and i.user_id = new.user_id;
  if source is null then
    return new;
  end if;
  n := goals.counted_rhythm_count(new.user_id, source, new.starts_on, new.ends_on);
  if n is not null then
    new.count := n;
  end if;
  return new;
end;
$$;

create trigger periods_counted
  before insert or update on goals.periods
  for each row execute function goals.periods_counted();

-- Recount a person's open counted periods; the trigger above does the counting.
create function goals.recount_rhythms(p_user uuid, p_source text) returns void
language sql
security definer
set search_path = ''
as $$
  update goals.periods p
     set count = p.count
    from goals.items i
   where i.id = p.item_id
     and i.user_id = p_user
     and p.user_id = p_user
     and i.counts_from = p_source
     and p.closed_at is null;
$$;

revoke all on function goals.recount_rhythms(uuid, text) from public;

create function goals.applications_recount() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform goals.recount_rhythms(old.user_id, 'applications');
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.user_id is distinct from old.user_id) then
    perform goals.recount_rhythms(new.user_id, 'applications');
  end if;
  return null;
end;
$$;

create trigger applications_recount_rhythms
  after insert or delete or update of submitted_at, user_id on job_search.applications
  for each row execute function goals.applications_recount();

-- Setting or clearing counts_from recounts the rhythm's open period at once.
create function goals.items_counts_from_changed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update goals.periods p
     set count = p.count
   where p.item_id = new.id
     and p.user_id = new.user_id
     and p.closed_at is null;
  return null;
end;
$$;

create trigger items_counts_from_changed
  after update of counts_from on goals.items
  for each row
  when (new.counts_from is distinct from old.counts_from)
  execute function goals.items_counts_from_changed();

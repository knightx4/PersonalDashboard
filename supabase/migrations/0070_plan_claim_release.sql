-- A step put back to not started loses its start time.
--
-- `started_at` is stamped by this trigger the first time a step is claimed and
-- has never been cleared, because until now nothing put a claim back. The
-- daily cron does: a claim nothing has touched for two hours is taken back, so
-- that the CLI, the brief and the next session stop reading a step as underway
-- when the session holding it died.
--
-- Left as it was, the timestamp survives the release, and the trigger only
-- stamps a start when there is none -- so the next session to claim that step
-- would inherit a claim already hours old, be swept off it by the next run,
-- and be shown on the page as having been at it since the day before. The
-- release has to be a real release.
--
-- Same reasoning as `completed_at`, which this trigger has always cleared on
-- anything that is not done or dropped: a step that is not finished has no
-- finish time, and a step that has not been started has no start time.

set search_path = public, extensions;

create or replace function public.plan_items_track_status()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.status = 'in_progress' and new.started_at is null then
    new.started_at := now();
  end if;

  if new.status = 'not_started' then
    new.started_at := null;
  end if;

  if new.status in ('done', 'dropped') then
    if tg_op = 'INSERT' or old.status not in ('done', 'dropped') then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;

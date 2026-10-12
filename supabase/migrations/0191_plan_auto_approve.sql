-- Auto approve: a switch on the runner that says yes to every proposal.
--
-- A session shaping an idea or re-shaping a feature writes its rows as
-- `proposed`, and nothing picks up a proposal until the person approves it.
-- With the switch on, the person has said yes in advance, so a proposed row is
-- written as `not_started` instead and the runner can take it.
--
-- The switch is a column on the runner's own row, one per account, because it
-- is a standing setting about what the runner may work on. Turning it on with
-- no row yet writes one with the runner off, which the row's checks allow.
--
-- The yes happens in a trigger rather than in the app, because sessions write
-- proposals straight through SQL and never pass through a server action. The
-- trigger is named to run before `plan_items_track_status` (triggers on the
-- same event fire in name order), so that one sees the approved status.
--
-- Rows already proposed when the switch goes on are approved by the action
-- that turns it on (`setAutoApprove` in app/dev/plan/actions.ts).

set search_path = public, extensions;

alter table plan_overnight_runs
  add column if not exists auto_approve boolean not null default false;

create or replace function public.plan_items_auto_approve()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.status = 'proposed' and exists (
    select 1 from plan_overnight_runs
    where user_id = new.user_id and auto_approve
  ) then
    new.status := 'not_started';
  end if;
  return new;
end;
$$;

revoke execute on function public.plan_items_auto_approve() from public, anon, authenticated;

create or replace trigger plan_items_auto_approve
  before insert or update of status on plan_items
  for each row execute function public.plan_items_auto_approve();

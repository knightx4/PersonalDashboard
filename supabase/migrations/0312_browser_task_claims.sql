-- The person's PC and Mac can claim a browser task, the PC first (plan
-- #3040.5, under #3040).
--
-- A session hand-off marked browser_task (0311) can be done in the person's
-- own Chrome by a runner they start on a computer of theirs (plan #3040.6).
-- Two computers can run one, so a task is claimed before it is worked:
--
--   dash_handoffs.claimed_by   'pc' or 'mac': the computer that took it.
--   dash_handoffs.claimed_at   when it took it.
--
--   core.browser_runners       one row per computer, with when its runner
--                              last said it was there (last_seen_at).
--
--   core.browser_runner_heartbeat(machine)
--                the runner's "still here", every so often: records now as
--                that computer's last_seen_at.
--   core.claim_browser_task(machine)
--                takes the oldest pending browser task nobody has claimed and
--                returns its id, or null when there is none to take. The PC
--                may always claim. The Mac may claim only when the PC has sent
--                no heartbeat in the last 2 minutes (answer on #3040.3: the PC
--                is preferred, the Mac covers when it is off). The row is
--                locked with skip locked and claimed in the same statement,
--                so two claimers never get the same task.
--
-- The runners and the tasks are the owner's alone, so both functions read
-- and write only the rows of core.dev_owner_id(). Schema only: no existing
-- row is changed by this file.

set search_path = core, public, extensions;

alter table core.dash_handoffs
  add column if not exists claimed_by text,
  add column if not exists claimed_at timestamptz;

alter table core.dash_handoffs
  add constraint dash_handoffs_claimed_by_ck check (claimed_by is null or claimed_by in ('pc', 'mac')),
  add constraint dash_handoffs_claimed_pair_ck check ((claimed_by is null) = (claimed_at is null)),
  add constraint dash_handoffs_claimed_browser_ck check (claimed_by is null or browser_task);

comment on column core.dash_handoffs.claimed_by is
  'The computer of the person''s that took this browser task: pc or mac (plan #3040.5). Null while unclaimed.';
comment on column core.dash_handoffs.claimed_at is
  'When claimed_by took this browser task (plan #3040.5).';

-- The claim's read: the oldest pending browser task nobody has taken.
create index if not exists dash_handoffs_browser_unclaimed_idx on core.dash_handoffs (user_id, created_at)
  where kind = 'session' and browser_task and status = 'pending' and claimed_by is null;

create table if not exists core.browser_runners (
  machine text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  constraint browser_runners_machine_ck check (machine in ('pc', 'mac'))
);

comment on table core.browser_runners is
  'The person''s computers that can do browser tasks, one row each, with when its runner last sent a heartbeat (plan #3040.5).';
comment on column core.browser_runners.last_seen_at is
  'When this computer''s runner last said it was there. The Mac claims only when the PC''s is over 2 minutes old.';

alter table core.browser_runners enable row level security;

create policy browser_runners_select on core.browser_runners for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on core.browser_runners from anon;
grant select on core.browser_runners to authenticated;
grant select, insert, update on core.browser_runners to service_role;

create or replace function core.browser_runner_heartbeat(p_machine text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := core.dev_owner_id();
  v_seen timestamptz;
begin
  if p_machine is null or p_machine not in ('pc', 'mac') then
    raise exception 'machine must be pc or mac, not %', coalesce(p_machine, 'null');
  end if;
  if v_owner is null then
    raise exception 'no owner is set in core.app_settings';
  end if;

  insert into core.browser_runners (machine, user_id, last_seen_at)
  values (p_machine, v_owner, now())
  on conflict (machine) do update set last_seen_at = excluded.last_seen_at, user_id = excluded.user_id
  returning last_seen_at into v_seen;
  return v_seen;
end;
$$;

comment on function core.browser_runner_heartbeat(text) is
  'A runner''s heartbeat: records now as the last_seen_at of the owner''s pc or mac (plan #3040.5).';

create or replace function core.claim_browser_task(p_machine text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := core.dev_owner_id();
  v_id uuid;
begin
  if p_machine is null or p_machine not in ('pc', 'mac') then
    raise exception 'machine must be pc or mac, not %', coalesce(p_machine, 'null');
  end if;
  if v_owner is null then
    return null;
  end if;

  update core.dash_handoffs h
     set claimed_by = p_machine,
         claimed_at = now()
   where h.id = (
       select c.id
         from core.dash_handoffs c
        where c.user_id = v_owner
          and c.kind = 'session'
          and c.browser_task
          and c.status = 'pending'
          and c.claimed_by is null
          and (
            p_machine = 'pc'
            or not exists (
              select 1 from core.browser_runners r
               where r.machine = 'pc'
                 and r.user_id = v_owner
                 and r.last_seen_at > now() - interval '2 minutes'
            )
          )
        order by c.created_at, c.id
        limit 1
        for update skip locked
     )
     and h.claimed_by is null
  returning h.id into v_id;

  return v_id;
end;
$$;

comment on function core.claim_browser_task(text) is
  'Claims the owner''s oldest pending, unclaimed browser task for pc or mac and returns its id, or null. The mac claims only when the pc has sent no heartbeat in 2 minutes (plan #3040.5).';

revoke all on function core.browser_runner_heartbeat(text) from public, anon, authenticated;
revoke all on function core.claim_browser_task(text) from public, anon, authenticated;
grant execute on function core.browser_runner_heartbeat(text) to service_role;
grant execute on function core.claim_browser_task(text) to service_role;

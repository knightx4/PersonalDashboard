-- Every change to a plan step, kept (plan #1829, feature #1828).
--
-- One row per insert, update or delete on plan_items, written by a trigger so
-- a write that forgets to record itself cannot happen. It is modelled on
-- goals.history (migrations-goals/0001).
--
-- History starts when this ships. Nothing is backfilled: the dated lines in a
-- step's comment keep being written and are the record before today.
--
-- Columns:
--   item_id, item_number  the step. item_id is not a foreign key, because the
--                         history of a step outlives the step.
--   action                'insert', 'update' or 'delete'.
--   old_values/new_values For an insert, new_values is the whole row; for a
--                         delete, old_values is. For an update both hold only
--                         the columns that changed, so a row reads as
--                         "status: in_progress -> done". updated_at and
--                         comment are left out of the diff: the comment is
--                         the dated lines, which already say what happened.
--   old_status/new_status Set when the status is what changed (and on insert
--                         and delete, to the row's status), so a reader
--                         asking "what was closed today" needs no jsonb.
--   actor                 'me' when the person made the change from the app
--                         (a signed-in request), 'claude' for anything else:
--                         scripts/plan.ts, the service role, SQL run through
--                         the connector. 'claude' is the stored value for
--                         Dash, as made_by = 'claude' is elsewhere. SQL that
--                         wants to say otherwise runs
--                         set local plan.actor = 'me'.
--   created_at            when it happened.
--
-- Append-only: the person can read their own rows and nothing else.

set search_path = public, extensions;

create table if not exists plan_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null,
  item_number integer,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  old_status text,
  new_status text,
  actor text not null,
  created_at timestamptz not null default now(),
  constraint plan_history_action_ck check (action in ('insert', 'update', 'delete')),
  constraint plan_history_actor_ck check (actor in ('me', 'claude'))
);

create index if not exists plan_history_user_created_idx
  on plan_history (user_id, created_at desc);
create index if not exists plan_history_item_idx
  on plan_history (item_id, created_at);
create index if not exists plan_history_status_idx
  on plan_history (user_id, new_status, created_at desc)
  where old_status is distinct from new_status;

create or replace function public.record_plan_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb;
  new_row jsonb;
  old_diff jsonb := '{}'::jsonb;
  new_diff jsonb := '{}'::jsonb;
  key text;
  owner uuid;
  act text;
  who text;
  claims_role text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    old_row := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new_row := to_jsonb(new);
  end if;

  owner := (coalesce(new_row, old_row) ->> 'user_id')::uuid;

  if tg_op = 'INSERT' then
    act := 'insert';
    old_diff := null;
    new_diff := new_row;
  elsif tg_op = 'DELETE' then
    -- The account going away takes its history with it; a row written now
    -- would point at a user who is already gone.
    if not exists (select 1 from auth.users u where u.id = owner) then
      return old;
    end if;
    act := 'delete';
    old_diff := old_row;
    new_diff := null;
  else
    for key in select jsonb_object_keys(new_row) loop
      if key not in ('updated_at', 'comment')
         and (old_row -> key) is distinct from (new_row -> key) then
        old_diff := old_diff || jsonb_build_object(key, old_row -> key);
        new_diff := new_diff || jsonb_build_object(key, new_row -> key);
      end if;
    end loop;
    if new_diff = '{}'::jsonb then
      return new;
    end if;
    act := 'update';
  end if;

  who := nullif(btrim(current_setting('plan.actor', true)), '');
  if who is null or who not in ('me', 'claude') then
    claims_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
    who := case when claims_role = 'authenticated' then 'me' else 'claude' end;
  end if;

  insert into public.plan_history
    (user_id, item_id, item_number, action, old_values, new_values,
     old_status, new_status, actor)
  values
    (owner,
     (coalesce(new_row, old_row) ->> 'id')::uuid,
     (coalesce(new_row, old_row) ->> 'number')::integer,
     act, old_diff, new_diff,
     case when tg_op = 'INSERT' then null else old_row ->> 'status' end,
     case when tg_op = 'DELETE' then null else new_row ->> 'status' end,
     who);

  return coalesce(new, old);
end;
$$;

revoke all on function public.record_plan_history() from public, anon, authenticated;

create trigger plan_items_history
  after insert or update or delete on plan_items
  for each row execute function public.record_plan_history();

alter table plan_history enable row level security;

create policy plan_history_select on plan_history for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on plan_history from anon, authenticated;
grant select on plan_history to authenticated;
grant select, insert on plan_history to service_role;

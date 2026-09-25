-- ===========================================================================
-- Flagging something on a goal that is not a step (plan #1015).
--
-- A run sometimes finds a thing the person should know that is neither a step
-- to do nor a question with options: the servicer moved the due date, a
-- statement shows a missed payment. Until now it could only go in the run's
-- summary, which is read by opening the run. It now goes in raised_items with
-- the goal it is about, and shows on the Goals home under Waiting on you and
-- on the goal's page, where it is answered.
--
--   public.raised_items.goal_id   the goal a flag is about. Null on every
--                                 raise from the dev plan. A raise with one
--                                 is written with module 'goals'.
--   goals.runs.job                gains 'raise': the run fired when the
--                                 person answers a flag on a goal.
--
-- In this folder rather than supabase/migrations because the foreign key
-- points into goals.items, and the goals folder is applied after the public
-- one (scripts/db-reset.sh).
-- ===========================================================================

alter table public.raised_items add column if not exists goal_id uuid;

-- The pair, as goals.runs does for areas, so a flag can only name a goal of
-- the same account.
alter table public.raised_items drop constraint if exists raised_items_goal_fk;
alter table public.raised_items add constraint raised_items_goal_fk
  foreign key (goal_id, user_id) references goals.items (id, user_id) on delete cascade;

alter table public.raised_items drop constraint if exists raised_items_goal_module_ck;
alter table public.raised_items add constraint raised_items_goal_module_ck
  check (goal_id is null or module = 'goals');

create index if not exists raised_items_goal_idx
  on public.raised_items (goal_id, status) where goal_id is not null;

comment on column public.raised_items.goal_id is
  'The goal a flag from a goals run is about (plan #1015). Shown on the Goals home and the goal page, and answered there. Null on raises from the dev plan.';

-- A foreign key cannot say the item is a goal rather than a step, so this
-- does. A flag on a step would name a row the Goals home never reads, and
-- vanish.
create or replace function goals.raised_item_is_goal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.goal_id is not null and not exists (
    select 1 from goals.items i where i.id = new.goal_id and i.level = 'goal'
  ) then
    raise exception 'A flag names a goal, not a step. Use the id of the goal the step is under.';
  end if;
  return new;
end;
$$;

drop trigger if exists raised_items_goal_level on public.raised_items;
create trigger raised_items_goal_level
  before insert or update of goal_id on public.raised_items
  for each row execute function goals.raised_item_is_goal();

alter table goals.runs drop constraint runs_job_ck;
alter table goals.runs add constraint runs_job_ck
  check (job in ('daily', 'weekly', 'goal', 'reshape', 'step', 'phase', 'prepare', 'area', 'raise'));

comment on column goals.runs.job is
  'What fired the run: daily (the morning run), weekly (review and research), goal (Work on this, or a comment on a goal), reshape (questions on the goal were answered), step or phase (sent from its row), prepare (one of your steps prepared), area (Plan this area) or raise (you answered a flag on the goal).';

notify pgrst, 'reload schema';

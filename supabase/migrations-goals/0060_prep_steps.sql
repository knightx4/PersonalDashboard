-- ===========================================================================
-- Record which of your steps a Dash step prepares (plan #1215).
--
-- Feature #1207 has Dash put a step of its own just before one of yours when
-- a draft, research, a shortlist or a list would help you do it: cover
-- letters before an application, a shortlist of staffing firms before "Call
-- three staffing firms". The prep step does not make your step wait, so it is
-- not a row in goals.dependencies. It says which step it is for in a column
-- of its own, and your step says whether Dash has judged it yet:
--
--   items.prepares_id       on a claude step, the step of yours it prepares.
--                           Null on every other row.
--   items.prep_checked_at   on a step of yours, when a run judged whether it
--                           needs a prep step. Set whether or not the run
--                           added one, so a step judged to need nothing is
--                           not offered to the morning run again. Null until
--                           then.
--
-- What the database holds a prep step to, for every writer:
--
--   - it is a claude step, and what it prepares is a step of yours (kind
--     'mine') of the same account and the same goal;
--   - a step of yours has at most one live prep step: one that is neither
--     dropped nor archived. A finished prep step still counts, since what it
--     produced is the prep. Dropping or archiving it frees the step for
--     another.
--
-- The guard (items_claude_guard, 0051) already lets Claude change a step of
-- yours under an approved goal in every way but dropping or archiving it, so
-- setting prep_checked_at needs nothing new there. The history trigger
-- records every column of the row, so both new columns are in history and a
-- run's undo can put them back.
-- ===========================================================================

alter table goals.items
  add column prepares_id uuid,
  add column prep_checked_at timestamptz;

alter table goals.items
  add constraint items_prepares_fk foreign key (prepares_id, user_id)
    references goals.items (id, user_id) on delete set null (prepares_id);

alter table goals.items
  add constraint items_prepares_ck check (
    prepares_id is null or (level = 'step' and kind = 'claude' and prepares_id <> id)
  );

alter table goals.items
  add constraint items_prep_checked_ck check (
    prep_checked_at is null or (level = 'step' and kind = 'mine')
  );

-- One live prep step per step of yours, and the lookup from a step to its
-- prep that the goal page (plan #1218) and the morning list (plan #1217) do.
create unique index items_one_live_prep_uq on goals.items (prepares_id)
  where prepares_id is not null and archived_at is null and status <> 'dropped';

comment on column goals.items.prepares_id is
  'On a claude step, the step of yours it prepares (plan #1215). The prep step does not make that step wait.';
comment on column goals.items.prep_checked_at is
  'On a step of yours, when a run judged whether it needs a Dash prep step (plan #1215). Null until judged.';

-- ---------------------------------------------------------------------------
-- Holding a prep step to a step of yours in the same goal.
-- ---------------------------------------------------------------------------
create or replace function goals.items_prepares_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target goals.items%rowtype;
begin
  if new.prepares_id is null
     or (tg_op = 'UPDATE' and new.prepares_id is not distinct from old.prepares_id
         and new.parent_id is not distinct from old.parent_id) then
    return new;
  end if;

  select * into target
  from goals.items t
  where t.id = new.prepares_id and t.user_id = new.user_id;

  if not found or target.level <> 'step' or target.kind is distinct from 'mine' then
    raise exception 'A Dash prep step can only prepare one of your own steps.'
      using errcode = 'check_violation';
  end if;
  if goals.goal_of(target.id, new.user_id) is distinct from goals.goal_of(new.parent_id, new.user_id) then
    raise exception 'A Dash prep step can only prepare a step of the same goal: "%" is under another.', target.title
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_prepares_check() from public, anon, authenticated;

create trigger items_prepares_check before insert or update on goals.items
  for each row execute function goals.items_prepares_check();

notify pgrst, 'reload schema';

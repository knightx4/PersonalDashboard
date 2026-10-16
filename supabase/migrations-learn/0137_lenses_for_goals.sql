-- Every subject and every learning goal is a lens (plan #2138.7,
-- docs/LEARN-LEVELS-SPEC.md, "Lenses: subjects and goals").
--
-- learn 0133 made the lens tables and 0136 made a lens for each subject the
-- move from the claims graph reaches. This makes the rest:
--
--   lenses.aim_id   the learning goal (learn.aims) a lens was made from, when
--                   origin is 'goal'. One lens per goal. Deleting the goal
--                   deletes its lens, which holds nothing of the person's but
--                   targets copied from their subjects.
--
-- Three triggers keep the set whole:
--
--   subjects -> a lens of the same name for every subject that is not a
--               hidden survey subject, made when the subject is and renamed
--               with it. A survey subject still gets its lens when it is
--               moved (0136), and one that becomes a real track gets it then.
--   aims     -> a goal lens for every learning goal, renamed with the goal,
--               and filled from its subjects' lenses when its track is set.
--   lens_targets on a subject's lens -> the same topic on the lens of each
--               goal whose track or survey subject that is, at the goal's
--               depth: familiar 2, solid 5, deep 8, never above the topic's
--               ceiling (lib/learn/levels/lenses.ts has the same three). A
--               topic already on the goal's lens keeps the target it has, so
--               a target the person set by hand is never overwritten.
--
-- The backfill at the end runs the same rules once over what exists.
-- Progress stays computed on read (rule R4); nothing here stores it.

set search_path = learn, public, extensions;

alter table learn.lenses add column if not exists aim_id uuid;

alter table learn.lenses
  add constraint lenses_aim_fk foreign key (aim_id, user_id)
    references learn.aims (id, user_id) on delete cascade;

alter table learn.lenses
  add constraint lenses_aim_ck check (aim_id is null or origin = 'goal');

create unique index if not exists lenses_aim_uq on learn.lenses (aim_id) where aim_id is not null;

comment on column learn.lenses.aim_id is
  'The learning goal this lens was made from (plan #2138.7). Set exactly when origin is goal and the goal still exists.';

-- ---------------------------------------------------------------------------
-- The target a goal's depth asks for on one topic.
-- ---------------------------------------------------------------------------
create or replace function learn.goal_target_level(p_depth text, p_ceiling smallint)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select least(
    coalesce(p_ceiling, 10),
    case p_depth when 'deep' then 8 when 'solid' then 5 else 2 end
  )::smallint;
$$;

-- ---------------------------------------------------------------------------
-- Fill one goal's lens from the lenses of its track and its survey subject.
-- ---------------------------------------------------------------------------
create or replace function learn.fill_goal_lens(p_aim_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  goal_lens uuid;
  goal_user uuid;
  goal_depth text;
  track uuid;
begin
  select l.id, a.user_id, a.depth, a.subject_id
    into goal_lens, goal_user, goal_depth, track
    from learn.aims a
    join learn.lenses l on l.aim_id = a.id
   where a.id = p_aim_id;
  if goal_lens is null then
    return;
  end if;

  insert into learn.lens_targets (user_id, lens_id, topic_id, target_level)
  select goal_user, goal_lens, t.topic_id, learn.goal_target_level(goal_depth, tp.ceiling)
    from learn.lens_targets t
    join learn.lenses sl on sl.id = t.lens_id and sl.origin = 'subject'
    join learn.topics tp on tp.id = t.topic_id
   where sl.user_id = goal_user
     and (sl.subject_id = track
          or sl.subject_id in (select s.id from learn.subjects s where s.aim_id = p_aim_id))
  on conflict (lens_id, topic_id) do nothing;
end;
$$;

revoke all on function learn.fill_goal_lens(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- subjects -> their lens.
-- ---------------------------------------------------------------------------
create or replace function learn.subjects_keep_lens()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.survey then
    update learn.lenses set name = new.name where subject_id = new.id and name <> new.name;
    return new;
  end if;
  insert into learn.lenses (user_id, name, origin, subject_id)
  values (new.user_id, new.name, 'subject', new.id)
  on conflict (subject_id) where subject_id is not null
  do update set name = excluded.name
  where learn.lenses.name <> excluded.name;
  return new;
end;
$$;

create trigger subjects_keep_lens
  after insert or update of name, survey on learn.subjects
  for each row execute function learn.subjects_keep_lens();

-- ---------------------------------------------------------------------------
-- aims -> their lens.
-- ---------------------------------------------------------------------------
create or replace function learn.aims_keep_lens()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into learn.lenses (user_id, name, origin, aim_id)
  values (new.user_id, new.name, 'goal', new.id)
  on conflict (aim_id) where aim_id is not null
  do update set name = excluded.name
  where learn.lenses.name <> excluded.name;

  if tg_op = 'INSERT' or new.subject_id is distinct from old.subject_id then
    perform learn.fill_goal_lens(new.id);
  end if;
  return new;
end;
$$;

create trigger aims_keep_lens
  after insert or update of name, subject_id on learn.aims
  for each row execute function learn.aims_keep_lens();

-- ---------------------------------------------------------------------------
-- A topic joining a subject's lens joins its goals' lenses.
-- ---------------------------------------------------------------------------
create or replace function learn.lens_targets_reach_goals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  subject uuid;
begin
  select l.subject_id into subject
    from learn.lenses l
   where l.id = new.lens_id and l.origin = 'subject';
  if subject is null then
    return new;
  end if;

  insert into learn.lens_targets (user_id, lens_id, topic_id, target_level)
  select a.user_id, gl.id, new.topic_id, learn.goal_target_level(a.depth, tp.ceiling)
    from learn.aims a
    join learn.lenses gl on gl.aim_id = a.id
    join learn.topics tp on tp.id = new.topic_id
   where a.user_id = new.user_id
     and (a.subject_id = subject
          or a.id = (select s.aim_id from learn.subjects s where s.id = subject))
  on conflict (lens_id, topic_id) do nothing;
  return new;
end;
$$;

create trigger lens_targets_reach_goals
  after insert on learn.lens_targets
  for each row execute function learn.lens_targets_reach_goals();

-- ---------------------------------------------------------------------------
-- Backfill: a lens for every real subject and every goal, then the goals'
-- targets from what their subjects' lenses already hold.
-- ---------------------------------------------------------------------------
insert into learn.lenses (user_id, name, origin, subject_id)
select s.user_id, s.name, 'subject', s.id
  from learn.subjects s
 where not s.survey
on conflict (subject_id) where subject_id is not null do nothing;

insert into learn.lenses (user_id, name, origin, aim_id)
select a.user_id, a.name, 'goal', a.id
  from learn.aims a
on conflict (aim_id) where aim_id is not null do nothing;

select learn.fill_goal_lens(a.id) from learn.aims a;

do $$
declare
  missing integer;
begin
  select count(*) into missing
    from learn.aims a
   where not exists (select 1 from learn.lenses l where l.aim_id = a.id);
  if missing > 0 then
    raise exception 'learn 0137: % learning goals were left without a lens', missing;
  end if;
  select count(*) into missing
    from learn.subjects s
   where not s.survey and not exists (select 1 from learn.lenses l where l.subject_id = s.id);
  if missing > 0 then
    raise exception 'learn 0137: % subjects were left without a lens', missing;
  end if;
end;
$$;

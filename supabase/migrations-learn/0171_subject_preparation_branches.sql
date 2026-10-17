-- A direction to go deeper, and a preparation run for that branch alone
-- (plan #2276.7).
--
-- A subject's first preparation lays out the whole territory at high level.
-- Once the person has answered thirty graded questions on the subject's lens,
-- its page offers two to four branches of that territory (its topics grouped
-- by the frame topic they refine). Picking one raises the lens targets of the
-- topics under it, records the choice on the subject's run, and opens a second
-- run for that branch alone, which the same runner works: it pulls and
-- matches documents for the branch, lays out the deeper topics beneath it,
-- drafts them onto the same lens and finishes. Dismissing the offer records
-- that instead. Either way the offer comes back after another thirty answers.
--
-- learn.subject_preparations gains:
--   branch      null on the subject's own run; on a branch run the branch it
--               prepares, as {key, frame, name, asks}, written by
--               lib/learn/prepare/branch.ts
--   branch_key  branch->>'key', so a subject holds one run of its own and one
--               per branch
--   direction   on the subject's own run, the last answer to the offer:
--               {state: picked | dismissed, key, name, answers, at}
--
-- The unique key on subject_id becomes two partial ones: one run of the
-- subject's own (branch_key is null) and one per branch. A branch run's steps
-- are the five the branch needs; classify and write_units belong to the
-- subject's own run.
--
-- choose_subject_direction and dismiss_subject_direction are the page's two
-- presses, run as the person: each checks the subject is theirs and writes
-- only their rows. lens_graded_answers is the count the offer waits on.
-- No existing row is rewritten.

set search_path = learn, public, extensions;

alter table learn.subject_preparations
  add column if not exists branch jsonb,
  add column if not exists direction jsonb;

alter table learn.subject_preparations
  add column if not exists branch_key text generated always as (branch ->> 'key') stored;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subject_preparations_branch_ck') then
    alter table learn.subject_preparations
      add constraint subject_preparations_branch_ck
        check (branch is null or (jsonb_typeof(branch) = 'object' and coalesce(branch ->> 'key', '') <> ''));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'subject_preparations_direction_ck') then
    alter table learn.subject_preparations
      add constraint subject_preparations_direction_ck
        check (direction is null or (branch is null and direction ->> 'state' in ('picked', 'dismissed')));
  end if;
end;
$$;

create unique index if not exists subject_preparations_own_uq
  on learn.subject_preparations (subject_id) where branch_key is null;
create unique index if not exists subject_preparations_branch_uq
  on learn.subject_preparations (subject_id, branch_key) where branch_key is not null;

alter table learn.subject_preparations
  drop constraint if exists subject_preparations_subject_id_key;

comment on column learn.subject_preparations.branch is
  'Null on the subject''s own run. On a branch run, the branch it prepares: {key, frame, name, asks}, from lib/learn/prepare/branch.ts (plan #2276.7).';
comment on column learn.subject_preparations.direction is
  'On the subject''s own run, the last answer to the direction offer: {state: picked | dismissed, key, name, answers, at}. The offer returns thirty graded answers after `answers`.';

-- The trigger opens the subject's own run, now matched by the partial key.
create or replace function learn.open_subject_preparation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prep uuid;
begin
  if new.survey then
    return new;
  end if;
  if tg_op = 'UPDATE' and not old.survey then
    return new;
  end if;

  insert into learn.subject_preparations (user_id, subject_id)
  values (new.user_id, new.id)
  on conflict (subject_id) where branch_key is null do nothing
  returning id into prep;
  if prep is null then
    return new;
  end if;

  -- The same seven keys, in the same order, as PREPARATION_STEPS in
  -- lib/learn/prepare/steps.ts; lib/learn/prepare/steps.test.ts holds them equal.
  insert into learn.subject_preparation_steps (preparation_id, user_id, key, ordinal)
  select prep, new.user_id, s.key, s.ordinal
  from unnest(array[
    'classify', 'pull_documents', 'match_weeks', 'compile_territory',
    'draft_topics', 'write_units', 'finish'
  ]::text[]) with ordinality as s(key, ordinal);
  return new;
end;
$$;

revoke all on function learn.open_subject_preparation() from public, anon, authenticated;

-- The count the offer waits on ------------------------------------------------

create or replace function learn.lens_graded_answers(p_user uuid, p_lens uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::int
    from learn.cell_questions q
    join learn.topic_cells c on c.id = q.cell_id
    join learn.lens_targets t on t.topic_id = c.topic_id and t.lens_id = p_lens
   where q.user_id = p_user
     and t.user_id = p_user
     and q.grade is not null;
$$;

revoke all on function learn.lens_graded_answers(uuid, uuid) from public, anon;
grant execute on function learn.lens_graded_answers(uuid, uuid) to authenticated, service_role;

-- Picking a direction ---------------------------------------------------------

create or replace function learn.choose_subject_direction(
  p_subject uuid,
  p_branch jsonb,
  p_answers integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  own uuid;
  prep uuid;
  lens uuid;
  asks text[];
begin
  if me is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if p_branch is null or coalesce(p_branch ->> 'key', '') = '' then
    raise exception 'Name the branch to go deeper on.' using errcode = '22023';
  end if;

  select id into own
    from learn.subject_preparations
   where subject_id = p_subject and user_id = me and branch_key is null
   for update;
  if own is null then
    raise exception 'No prepared subject of yours has that id.' using errcode = 'P0002';
  end if;

  update learn.subject_preparations
     set direction = jsonb_build_object(
           'state', 'picked',
           'key', p_branch ->> 'key',
           'name', p_branch ->> 'name',
           'answers', greatest(0, coalesce(p_answers, 0)),
           'at', now()),
         updated_at = now()
   where id = own;

  insert into learn.subject_preparations (user_id, subject_id, branch)
  values (me, p_subject, p_branch)
  on conflict (subject_id, branch_key) where branch_key is not null do nothing
  returning id into prep;

  if prep is not null then
    -- The five steps a branch needs, at their places in PREPARATION_STEPS
    -- (BRANCH_STEPS in lib/learn/prepare/branch.ts).
    insert into learn.subject_preparation_steps (preparation_id, user_id, key, ordinal)
    values
      (prep, me, 'pull_documents', 2),
      (prep, me, 'match_weeks', 3),
      (prep, me, 'compile_territory', 4),
      (prep, me, 'draft_topics', 5),
      (prep, me, 'finish', 7);
  else
    select id into prep
      from learn.subject_preparations
     where subject_id = p_subject and user_id = me and branch_key = p_branch ->> 'key';
  end if;

  -- One level higher on every topic under the branch, within its ceiling.
  select id into lens from learn.lenses where user_id = me and subject_id = p_subject limit 1;
  if lens is not null and jsonb_typeof(p_branch -> 'asks') = 'array' then
    select array_agg(lower(trim(a))) into asks from jsonb_array_elements_text(p_branch -> 'asks') as a;
    update learn.lens_targets lt
       set target_level = least(lt.target_level + 1, coalesce(tp.ceiling, 10), 10),
           updated_at = now()
      from learn.topics tp
     where lt.lens_id = lens
       and lt.user_id = me
       and tp.id = lt.topic_id
       and tp.user_id = me
       and lower(trim(tp.asked)) = any(asks)
       and lt.target_level < least(coalesce(tp.ceiling, 10), 10);
  end if;

  return prep;
end;
$$;

create or replace function learn.dismiss_subject_direction(p_subject uuid, p_answers integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  update learn.subject_preparations
     set direction = jsonb_build_object(
           'state', 'dismissed',
           'answers', greatest(0, coalesce(p_answers, 0)),
           'at', now()),
         updated_at = now()
   where subject_id = p_subject and user_id = me and branch_key is null;
  if not found then
    raise exception 'No prepared subject of yours has that id.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function learn.choose_subject_direction(uuid, jsonb, integer) from public, anon;
revoke all on function learn.dismiss_subject_direction(uuid, integer) from public, anon;
grant execute on function learn.choose_subject_direction(uuid, jsonb, integer) to authenticated;
grant execute on function learn.dismiss_subject_direction(uuid, integer) to authenticated;

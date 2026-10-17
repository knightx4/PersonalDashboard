-- One lens per subject, read by its goals (plan #2302.3,
-- docs/LEARN-LEVELS-SPEC.md, "Lenses: subjects and goals").
--
-- learn 0137 gave every learning goal a lens of its own beside its subject's,
-- filled with copies of the subject lens's topics at the goal's depth. Two
-- lenses over the same topics drifted apart (a topic added on one did not
-- always reach the other), and the Know page listed the subject twice. From
-- here a goal reads its subject's lens: the lens of learn.subjects where
-- id = aims.subject_id (lib/learn/levels/lens-store.ts `goalLensId`).
--
--   1. The triggers that made and filled goal lenses stop: aims_keep_lens
--      and lens_targets_reach_goals, with fill_goal_lens.
--   2. A subject's lens now goes with the subject. It was left behind with
--      subject_id cleared, which is how an orphan "Urban economics" lens
--      came to sit on the Know page with no subject under it.
--   3. For the owner's account only (CLAUDE.md, "Only the owner's account is
--      touched"): a topic a goal lens holds that its subject's lens lacks
--      joins the subject's lens at the goal's target, a comment thread on a
--      goal lens moves to the subject's lens when that has none, and then
--      the goal lenses and the subject lenses with no subject are deleted.
--      These are duplicate rows; nothing the person wrote is lost.
--
-- Other accounts keep any goal lens they have until their own clean-up; the
-- app no longer reads one (listLenses skips origin 'goal').

set search_path = learn, public, extensions;

-- 1. Stop making goal lenses ------------------------------------------------
drop trigger if exists aims_keep_lens on learn.aims;
drop trigger if exists lens_targets_reach_goals on learn.lens_targets;
drop function if exists learn.aims_keep_lens();
drop function if exists learn.lens_targets_reach_goals();
drop function if exists learn.fill_goal_lens(uuid);

comment on column learn.lenses.aim_id is
  'Retired by plan #2302.3: a goal reads its subject''s lens. Set only on goal lenses made before learn 0176, which the app skips.';

-- 2. A subject's lens goes with it -----------------------------------------
alter table learn.lenses drop constraint if exists lenses_subject_fk;
alter table learn.lenses
  add constraint lenses_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete cascade;

-- 3. The owner's duplicate lenses ------------------------------------------
-- `moves` pairs each of the owner's goal lenses with its subject's lens.
with moves as (
  select gl.id as goal_lens, sl.id as subject_lens, gl.user_id
    from learn.lenses gl
    join learn.aims a on a.id = gl.aim_id
    join learn.lenses sl on sl.subject_id = a.subject_id and sl.user_id = gl.user_id
   where gl.origin = 'goal'
     and gl.user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'
)
insert into learn.lens_targets (user_id, lens_id, topic_id, target_level)
select t.user_id, m.subject_lens, t.topic_id, t.target_level
  from moves m
  join learn.lens_targets t on t.lens_id = m.goal_lens
on conflict (lens_id, topic_id) do nothing;

with moves as (
  select gl.id as goal_lens, sl.id as subject_lens, gl.user_id
    from learn.lenses gl
    join learn.aims a on a.id = gl.aim_id
    join learn.lenses sl on sl.subject_id = a.subject_id and sl.user_id = gl.user_id
   where gl.origin = 'goal'
     and gl.user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'
)
update core.conversations c
   set subject_ref = 'learn.lenses:' || m.subject_lens
  from moves m
 where c.user_id = m.user_id
   and c.subject_kind = 'row'
   and c.subject_ref = 'learn.lenses:' || m.goal_lens
   and not exists (
     select 1 from core.conversations o
      where o.user_id = m.user_id and o.subject_kind = 'row' and o.subject_ref = 'learn.lenses:' || m.subject_lens
   );

delete from learn.lenses
 where user_id = 'd001bb0f-ffe8-4bfb-880f-17dd1a62b685'
   and (origin = 'goal' or (origin = 'subject' and subject_id is null));

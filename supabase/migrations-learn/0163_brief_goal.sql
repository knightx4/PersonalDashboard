-- The goal a research brief belongs to (plan #2184.1; feature #2184 "Learn
-- from your own questions").
--
-- learn.briefs.aim_id is the learning goal (learn.aims) whose map the brief
-- feeds. It is set when the person approves a topic drafted from the brief
-- under that goal: the topic joins the goal's lens, and from then on the
-- brief's cards are written for that goal, one per answered sub-question
-- with the brief's own sections as material. Null for a brief no topic has
-- been approved from. Deleting the goal leaves the brief, with no goal.

set search_path = learn, public, extensions;

alter table learn.briefs
  add column if not exists aim_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'briefs_aim_fk') then
    alter table learn.briefs
      add constraint briefs_aim_fk
      foreign key (aim_id, user_id) references learn.aims (id, user_id)
      on delete set null (aim_id);
  end if;
end;
$$;

create index if not exists briefs_aim_idx
  on learn.briefs (aim_id) where aim_id is not null;

comment on column learn.briefs.aim_id is
  'The learning goal this brief feeds: set when a topic drafted from it is approved under that goal (plan #2184.1).';

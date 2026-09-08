-- The round number belongs to the round, and every interview is in one.
--
-- Rounds arrived late: interviews came first and carried a `round` integer
-- each, then `interview_groups` was added above them to hold a superday. That
-- left two answers to "which round is this" -- the integer on each interview
-- and the group they may or may not be in -- and they disagreed constantly.
-- The Galaxy superday is the case in point: one afternoon, four conversations,
-- numbered 1, 3 and 4 with the fourth missing entirely.
--
-- So the number moves up to where the thing it names actually lives. A round
-- has a number and a name; an interview has a time, a panel and its notes, and
-- no opinion about which round it is -- it is in one.
--
-- `interviews.round` is NOT dropped. It keeps a real job, narrowed to the one
-- it can actually do: the interview's position inside its own round, which is
-- what orders the four conversations of a superday. Nothing displays it any
-- more; the number a reader sees is `interview_groups.round_number`.

set search_path = job_search, extensions;

begin;

alter table interview_groups add column if not exists round_number int;

-- ---------------------------------------------------------------------------
-- Every interview into a round.
--
-- A loop rather than a set-based insert because each new round has to be
-- matched back to the one interview it was made for, and an `insert ...
-- returning` gives no way to correlate the rows it produced with the rows it
-- read. There are tens of these, not millions.
-- ---------------------------------------------------------------------------
do $$
declare
  orphan record;
  made uuid;
begin
  for orphan in
    select id, user_id, application_id from interviews where group_id is null
  loop
    insert into interview_groups (user_id, application_id)
    values (orphan.user_id, orphan.application_id)
    returning id into made;

    update interviews set group_id = made where id = orphan.id;
  end loop;
end
$$;

-- Numbered per pursuit, in the order the rounds actually happen. The old
-- per-interview numbers are not carried across: they are the numbering this
-- migration exists to replace, and where they disagreed with the calendar the
-- calendar was right.
update interview_groups g
set round_number = ordered.position
from (
  select
    inner_group.id,
    row_number() over (
      partition by inner_group.application_id
      order by
        (select min(i.scheduled_at) from interviews i where i.group_id = inner_group.id)
          nulls last,
        inner_group.created_at
    ) as position
  from interview_groups inner_group
) as ordered
where g.id = ordered.id;

-- The interview's place within its own round.
update interviews i
set round = ordered.position
from (
  select
    id,
    row_number() over (
      partition by group_id
      order by scheduled_at nulls last, created_at
    ) as position
  from interviews
) as ordered
where i.id = ordered.id
  and i.round is distinct from ordered.position;

-- ---------------------------------------------------------------------------
-- Now it can be required.
--
-- The foreign key has to change with it: `on delete set null` cannot satisfy a
-- not-null column, so dropping a round would fail outright. Cascade is the
-- honest replacement now that an interview cannot exist outside a round -- and
-- it is not a way to lose one by accident, because the app only ever offers to
-- delete a round that is already empty.
-- ---------------------------------------------------------------------------
alter table interviews drop constraint if exists interviews_group_id_fkey;

alter table interviews
  add constraint interviews_group_id_fkey
  foreign key (group_id) references interview_groups (id) on delete cascade;

alter table interviews alter column group_id set not null;

commit;

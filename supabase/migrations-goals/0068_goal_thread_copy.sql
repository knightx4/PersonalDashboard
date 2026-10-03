-- Copy the threads on goals and steps into core.conversations, and make
-- goals.comments read-only (plan #1470).
--
-- Each goal's or step's thread moves under its ref, `goals.items:<id>`, as
-- decided on 2 October 2026 (docs/CORE-AND-DASH-SPEC.md, decision 1). The
-- table stays, refusing writes, until the person says it can go after 30
-- days. Nothing is deleted.
--
-- The same order as the main folder's 0168: lock, then copy, in one
-- transaction, then count per goal or step and stop if any differs. Each
-- comment keeps its id as the turn's id, so the copy can run again without
-- doubling.

set search_path = goals, core, public, extensions;

create or replace trigger comments_read_only
  before insert or update on goals.comments
  for each row execute function core.refuse_thread_writes();

insert into core.conversations (user_id, subject_kind, subject_ref)
select distinct user_id, 'row', 'goals.items:' || item_id from goals.comments
on conflict (user_id, subject_kind, subject_ref) do nothing;

insert into core.conversation_turns (id, conversation_id, user_id, role, body, created_at)
select g.id, c.id, g.user_id,
       case g.author when 'me' then 'user' else 'assistant' end,
       g.body, g.created_at
  from goals.comments g
  join core.conversations c
    on c.user_id = g.user_id and c.subject_kind = 'row'
   and c.subject_ref = 'goals.items:' || g.item_id
on conflict (id) do nothing;

do $$
declare
  differing integer;
begin
  with old as (
    select user_id, 'goals.items:' || item_id as ref, count(*) as n
      from goals.comments
     group by user_id, item_id
  ),
  copied as (
    select t.user_id, t.ref, count(*) as n
      from core.thread_turns t
     where t.id in (select id from goals.comments)
     group by t.user_id, t.ref
  )
  select count(*) into differing
    from old full join copied using (user_id, ref)
   where old.n is distinct from copied.n;

  if differing > 0 then
    raise exception 'goal_thread_copy: % goals or steps have a different number of comments after the copy', differing;
  end if;
end;
$$;

comment on table goals.comments is
  'Read-only since plan #1470: the threads on goals and steps are in core.conversations under goals.items:<id>. Kept until the person says it can go, after 30 days.';

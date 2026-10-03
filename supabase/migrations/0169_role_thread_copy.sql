-- Copy each role's thread into core.conversations, and stop job_search.notes
-- taking any more of it (plan #1470).
--
-- A role's thread was its notes in job_search.notes, `author` telling your
-- comments from Dash's replies (0033). It moves to core.conversations under
-- the role's ref, `job_search.roles:<id>`, as decided on 2 October 2026
-- (docs/CORE-AND-DASH-SPEC.md, decision 1). The notes on a company, a contact,
-- an application or a round are notes rather than a conversation with Dash,
-- and they stay here and keep taking writes: only a note with role_id set is
-- turned away. Nothing is deleted.
--
-- In this folder rather than the job-search folder, which runs before
-- core.conversations exists on a fresh database. The same order as 0168:
-- lock, then copy, in one transaction, then count per role and stop if any
-- differs. Each note keeps its id as the turn's id, so the copy can run again
-- without doubling.

set search_path = job_search, core, public, extensions;

create or replace trigger notes_role_thread_read_only
  before insert or update on job_search.notes
  for each row when (new.role_id is not null)
  execute function core.refuse_thread_writes();

insert into core.conversations (user_id, subject_kind, subject_ref)
select distinct user_id, 'row', 'job_search.roles:' || role_id
  from job_search.notes
 where role_id is not null
on conflict (user_id, subject_kind, subject_ref) do nothing;

insert into core.conversation_turns (id, conversation_id, user_id, role, body, created_at)
select n.id, c.id, n.user_id,
       case n.author when 'me' then 'user' else 'assistant' end,
       n.body, n.created_at
  from job_search.notes n
  join core.conversations c
    on c.user_id = n.user_id and c.subject_kind = 'row'
   and c.subject_ref = 'job_search.roles:' || n.role_id
 where n.role_id is not null
on conflict (id) do nothing;

do $$
declare
  differing integer;
begin
  with old as (
    select user_id, 'job_search.roles:' || role_id as ref, count(*) as n
      from job_search.notes
     where role_id is not null
     group by user_id, role_id
  ),
  copied as (
    select t.user_id, t.ref, count(*) as n
      from core.thread_turns t
     where t.id in (select id from job_search.notes where role_id is not null)
     group by t.user_id, t.ref
  )
  select count(*) into differing
    from old full join copied using (user_id, ref)
   where old.n is distinct from copied.n;

  if differing > 0 then
    raise exception 'role_thread_copy: % roles have a different number of comments after the copy', differing;
  end if;
end;
$$;

comment on column job_search.notes.author is
  '''me'' for what you wrote, ''claude'' for a reply from Dash. A role''s thread moved to core.conversations in plan #1470, and a note with role_id set is no longer written here.';

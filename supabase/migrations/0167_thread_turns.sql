-- One way to write and read a row's thread in core.conversations (plan #1470).
--
-- docs/CORE-AND-DASH-SPEC.md, Part 2: core.conversations is the one thread
-- store, and the threads that were kept in dev_comments, goals.comments,
-- core.file_comments and job_search.notes are copied into it (0168, and the
-- same step in the job-search and goals folders). This file holds what those
-- copies and the app share:
--
--   add_thread_turn   writes one turn under a row's ref, starting the thread
--                     when there is none, and returns the turn's id. One call
--                     where the app and the routines' SQL used to write an
--                     insert into a table per kind of row. Security invoker,
--                     so a signed-in caller writes only under rows of their
--                     own (RLS, and core.refs_check on the conversation).
--   thread_turns      a row thread's turns, flat, with the ref beside each and
--                     the author spelt as the old tables spelt it ('me' for
--                     the person, 'claude' for Dash). What a page, Dash and a
--                     routine read a thread through.
--   refuse_thread_writes
--                     the trigger function that makes an old thread table
--                     read-only once its rows are copied. Deletes still go
--                     through, so deleting the row a comment sat under keeps
--                     working until the old tables are removed.
--
-- A Dash reply on a role can be longer than the 8000 characters a turn held:
-- one of the role notes being copied is 8029. The limit becomes 20000.

set search_path = core, public, extensions;

alter table core.conversation_turns
  drop constraint conversation_turns_body_ck;
alter table core.conversation_turns
  add constraint conversation_turns_body_ck check (btrim(body) <> '' and length(body) <= 20000);

create or replace function core.add_thread_turn(
  p_user_id uuid,
  p_ref text,
  p_author text,
  p_body text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  conversation uuid;
  turn uuid;
begin
  if p_author is null or p_author not in ('me', 'claude') then
    raise exception 'add_thread_turn: author must be me or claude, not %', p_author
      using errcode = 'check_violation';
  end if;

  insert into core.conversations (user_id, subject_kind, subject_ref)
  values (p_user_id, 'row', p_ref)
  on conflict (user_id, subject_kind, subject_ref) do nothing;

  select c.id into conversation
    from core.conversations c
   where c.user_id = p_user_id and c.subject_kind = 'row' and c.subject_ref = p_ref;
  if conversation is null then
    raise exception 'add_thread_turn: no thread under % for this account', p_ref
      using errcode = 'insufficient_privilege';
  end if;

  insert into core.conversation_turns (conversation_id, user_id, role, body)
  values (conversation, p_user_id, case p_author when 'me' then 'user' else 'assistant' end, p_body)
  returning id into turn;

  return turn;
end;
$$;

revoke all on function core.add_thread_turn(uuid, text, text, text) from public, anon;
grant execute on function core.add_thread_turn(uuid, text, text, text) to authenticated, service_role;

create or replace view core.thread_turns
with (security_invoker = true)
as
select t.id,
       t.user_id,
       c.subject_ref as ref,
       case t.role when 'user' then 'me' else 'claude' end as author,
       t.body,
       t.created_at
  from core.conversation_turns t
  join core.conversations c on c.id = t.conversation_id and c.user_id = t.user_id
 where c.subject_kind = 'row';

revoke all on core.thread_turns from anon;
grant select on core.thread_turns to authenticated, service_role;

comment on view core.thread_turns is
  'Every row thread''s turns, one per line, with the ref of the row it sits under and the author as ''me'' or ''claude'' (plan #1470). Write with core.add_thread_turn.';

create or replace function core.refuse_thread_writes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%.% is read-only: threads are kept in core.conversations now (plan #1470). Write with core.add_thread_turn.',
    tg_table_schema, tg_table_name
    using errcode = 'read_only_sql_transaction';
end;
$$;

revoke all on function core.refuse_thread_writes() from public, anon, authenticated;

notify pgrst, 'reload schema';

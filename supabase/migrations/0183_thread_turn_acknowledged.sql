-- A seen mark on a comment (plan #1648, feature #1646).
--
-- When you tag Dash on a comment that needs nothing back, Dash may mark the
-- comment as seen and write no reply. The mark is kept on the comment itself:
-- it belongs to one turn and has nothing else to hold, so it is a column on
-- core.conversation_turns rather than a table of its own.
--
--   acknowledged_at        when Dash saw the comment and chose not to reply.
--                          Null on a comment nothing has acknowledged. Allowed
--                          only on the person's own turns (role 'user'): Dash
--                          does not mark its own words.
--   acknowledge_thread_turn
--                          sets it, so the app and the sessions write the mark
--                          the same way, as add_thread_turn is the one way to
--                          write a comment. Security invoker, so a signed-in
--                          caller marks only comments of their own.
--   thread_turns           the row-thread view gains acknowledged_at, last, so
--                          every loader reading threads through it gets the
--                          mark with the comment.

set search_path = core, public, extensions;

alter table core.conversation_turns
  add column acknowledged_at timestamptz;

alter table core.conversation_turns
  add constraint conversation_turns_acknowledged_ck
  check (acknowledged_at is null or role = 'user');

comment on column core.conversation_turns.acknowledged_at is
  'When Dash saw this comment and chose not to reply (plan #1648). Only on the person''s own turns. Set with core.acknowledge_thread_turn.';

create or replace function core.acknowledge_thread_turn(
  p_user_id uuid,
  p_ref text,
  p_turn uuid
)
returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  marked timestamptz;
begin
  update core.conversation_turns t
     set acknowledged_at = coalesce(t.acknowledged_at, clock_timestamp())
    from core.conversations c
   where t.id = p_turn
     and t.user_id = p_user_id
     and t.role = 'user'
     and c.id = t.conversation_id
     and c.user_id = t.user_id
     and c.subject_kind = 'row'
     and c.subject_ref = p_ref
  returning t.acknowledged_at into marked;

  if marked is null then
    raise exception 'acknowledge_thread_turn: % is not a comment of yours under %', p_turn, p_ref
      using errcode = 'insufficient_privilege';
  end if;

  return marked;
end;
$$;

revoke all on function core.acknowledge_thread_turn(uuid, text, uuid) from public, anon;
grant execute on function core.acknowledge_thread_turn(uuid, text, uuid) to authenticated, service_role;

create or replace view core.thread_turns
with (security_invoker = true)
as
select t.id,
       t.user_id,
       c.subject_ref as ref,
       case t.role when 'user' then 'me' else 'claude' end as author,
       t.body,
       t.created_at,
       t.acknowledged_at
  from core.conversation_turns t
  join core.conversations c on c.id = t.conversation_id and c.user_id = t.user_id
 where c.subject_kind = 'row';

comment on view core.thread_turns is
  'Every row thread''s turns, one per line, with the ref of the row it sits under and the author as ''me'' or ''claude'' (plan #1470). acknowledged_at is set on a comment Dash saw and did not reply to (plan #1648). Write with core.add_thread_turn and core.acknowledge_thread_turn.';

notify pgrst, 'reload schema';

-- Copy Maya's threads into core.conversations, and make the tables they were
-- kept in read-only (plan #1479).
--
-- Decided 2 October 2026 (docs/CORE-AND-DASH-SPEC.md, decision 2): Maya is
-- one of Dash's voices, on the same loop and the same thread store. A note's
-- thread with Maya moves from obsidian.maya_threads and maya_messages
-- (0028) to core.conversations under the note's ref, `obsidian.notes:<id>`,
-- the same as every other row thread (plan #1470). As in 0168 and 0169 the old
-- tables stop taking writes and nothing is deleted; they are removed only when
-- the person says so, after 30 days.
--
-- What a Maya thread holds beyond another thread's turns goes in four columns
-- on the conversation and one on the turn:
--
--   voice        'maya' on a thread Maya speaks in. Null is Dash's own voice.
--   origin       whether the person asked for the thought ('asked') or the
--                gate picked the note ('automatic'). The gate counts the
--                automatic ones to keep to its daily limit.
--   summary      where the person has got to on the question, rewritten after
--   summary_at   each reply, and when.
--   detail       on a turn: what the model reported beyond its words. A
--                thought keeps its points, the note version it read and the
--                model, which the thread draws its cards from.
--
-- The thread's question is the conversation's title. Each thread keeps its id
-- as the conversation's id, so a link to /vault/maya/<id> still opens it, and
-- each message keeps its id as the turn's, so the copy can run again without
-- writing anything twice.
--
-- In the vault folder, which runs after core.conversations exists on a fresh
-- database. Lock, then copy, in one transaction, then count per thread and
-- stop if any differs.

set search_path = obsidian, core, public, extensions;

alter table core.conversations
  add column if not exists voice text,
  add column if not exists origin text,
  add column if not exists summary text,
  add column if not exists summary_at timestamptz;

alter table core.conversations
  add constraint conversations_voice_ck check (voice is null or voice = 'maya'),
  add constraint conversations_origin_ck check (origin is null or origin in ('asked', 'automatic')),
  add constraint conversations_summary_ck check (summary is null or length(summary) <= 2000);

alter table core.conversation_turns
  add column if not exists detail jsonb;

alter table core.conversation_turns
  add constraint conversation_turns_detail_ck
  check (detail is null or (jsonb_typeof(detail) = 'object' and role = 'assistant'));

comment on column core.conversations.voice is
  '''maya'' on a thread Maya speaks in, a voice of Dash''s (plan #1479). Null for Dash''s own.';
comment on column core.conversations.origin is
  'For a Maya thread: ''asked'' when the person asked for the thought, ''automatic'' when the gate picked the note.';
comment on column core.conversations.summary is
  'For a Maya thread: where the person has got to on the question, rewritten after each reply.';
comment on column core.conversation_turns.detail is
  'What the model reported beyond its words. A Maya thought keeps its points, note_blob_sha and model here (plan #1479).';

create index if not exists conversations_voice_idx
  on core.conversations (user_id, created_at desc)
  where voice is not null;

create or replace trigger maya_threads_read_only
  before insert or update on obsidian.maya_threads
  for each row execute function core.refuse_thread_writes();

create or replace trigger maya_messages_read_only
  before insert or update on obsidian.maya_messages
  for each row execute function core.refuse_thread_writes();

insert into core.conversations
  (id, user_id, subject_kind, subject_ref, title, voice, origin, summary, summary_at, created_at)
select t.id, t.user_id, 'row', 'obsidian.notes:' || t.note_id, t.question, 'maya', t.origin,
       t.summary, t.summary_at, t.created_at
  from obsidian.maya_threads t
on conflict do nothing;

insert into core.conversation_turns (id, conversation_id, user_id, role, body, created_at, detail)
select m.id, c.id, m.user_id,
       case m.role when 'person' then 'user' else 'assistant' end,
       m.body, m.created_at,
       case when m.role = 'maya' then
         jsonb_strip_nulls(jsonb_build_object(
           'kind', m.kind, 'points', m.points, 'note_blob_sha', m.note_blob_sha, 'model', m.model))
       end
  from obsidian.maya_messages m
  join obsidian.maya_threads t on t.id = m.thread_id and t.user_id = m.user_id
  join core.conversations c
    on c.user_id = t.user_id and c.subject_kind = 'row'
   and c.subject_ref = 'obsidian.notes:' || t.note_id
on conflict (id) do nothing;

do $$
declare
  differing integer;
begin
  with old as (
    select t.user_id, 'obsidian.notes:' || t.note_id as ref, count(m.id) as n
      from obsidian.maya_threads t
      left join obsidian.maya_messages m on m.thread_id = t.id
     group by t.user_id, t.note_id
  ),
  copied as (
    select c.user_id, c.subject_ref as ref, count(ct.id) as n
      from core.conversations c
      left join core.conversation_turns ct
        on ct.conversation_id = c.id
       and ct.id in (select id from obsidian.maya_messages)
     where c.subject_kind = 'row' and c.voice = 'maya'
     group by c.user_id, c.subject_ref
  )
  select count(*) into differing
    from old full join copied using (user_id, ref)
   where old.n is distinct from copied.n;

  if differing > 0 then
    raise exception 'maya_threads_copy: % threads have a different number of messages after the copy', differing;
  end if;
end;
$$;

comment on table obsidian.maya_threads is
  'Maya''s threads as they were before plan #1479 moved them to core.conversations. Read-only; kept until the person says it can go.';
comment on table obsidian.maya_messages is
  'The turns of Maya''s threads as they were before plan #1479 moved them to core.conversation_turns. Read-only; kept until the person says it can go.';

notify pgrst, 'reload schema';

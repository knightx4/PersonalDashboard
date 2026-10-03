-- Copy the dev threads and the file threads into core.conversations, and make
-- the tables they were kept in read-only (plan #1470).
--
-- Decided 2 October 2026 (docs/CORE-AND-DASH-SPEC.md, decision 1): every
-- existing thread is copied in and checked by count, the old tables stop
-- taking writes, and they are removed only when the person says so after 30
-- days. Nothing here deletes a row.
--
-- Each table is locked first, with the trigger that refuses writes, and copied
-- after, in the same transaction: a comment written a moment before is copied,
-- and one written after is refused rather than lost between the two.
--
-- A comment keeps its id as the turn's id, so the copy can run again without
-- writing anything twice, and an id held anywhere else still names the same
-- comment. Its author becomes the turn's role ('me' the person, 'claude'
-- Dash) and its time is kept. The thread sits under the ref of the row the
-- comment was on, `schema.table:id`, owned by the comment's account, which
-- core.refs_check confirms as each thread starts.
--
-- The check at the end counts, for every row, the comments the old table holds
-- and the copied turns under that row's ref, and stops the whole file if any
-- row differs.

set search_path = core, public, extensions;

-- public.dev_comments: ideas, plan rows, raises, bug notes, spec sections,
-- takeaways and spec changes.

create or replace trigger dev_comments_read_only
  before insert or update on public.dev_comments
  for each row execute function core.refuse_thread_writes();

-- The ref each comment's row is named by. A view for the length of this file,
-- so the copy and the count below read the same thing.
create view public.dev_comment_refs as
select d.id, d.user_id, d.author, d.body, d.created_at,
       case
         when d.idea_id is not null then 'public.ideas:' || d.idea_id
         when d.plan_item_id is not null then 'public.plan_items:' || d.plan_item_id
         when d.raised_item_id is not null then 'public.raised_items:' || d.raised_item_id
         when d.feedback_item_id is not null then 'public.feedback_items:' || d.feedback_item_id
         when d.spec_section_id is not null then 'public.spec_sections:' || d.spec_section_id
         when d.inspiration_takeaway_id is not null then 'public.inspiration_takeaways:' || d.inspiration_takeaway_id
         when d.spec_change_id is not null then 'public.spec_changes:' || d.spec_change_id
       end as ref
  from public.dev_comments d;

insert into core.conversations (user_id, subject_kind, subject_ref)
select distinct user_id, 'row', ref from public.dev_comment_refs
on conflict (user_id, subject_kind, subject_ref) do nothing;

insert into core.conversation_turns (id, conversation_id, user_id, role, body, created_at)
select d.id, c.id, d.user_id,
       case d.author when 'me' then 'user' else 'assistant' end,
       d.body, d.created_at
  from public.dev_comment_refs d
  join core.conversations c
    on c.user_id = d.user_id and c.subject_kind = 'row' and c.subject_ref = d.ref
on conflict (id) do nothing;

-- core.file_comments: the thread under a file.

create or replace trigger file_comments_read_only
  before insert or update on core.file_comments
  for each row execute function core.refuse_thread_writes();

insert into core.conversations (user_id, subject_kind, subject_ref)
select distinct user_id, 'row', 'core.files:' || file_id from core.file_comments
on conflict (user_id, subject_kind, subject_ref) do nothing;

insert into core.conversation_turns (id, conversation_id, user_id, role, body, created_at)
select f.id, c.id, f.user_id,
       case f.author when 'me' then 'user' else 'assistant' end,
       f.body, f.created_at
  from core.file_comments f
  join core.conversations c
    on c.user_id = f.user_id and c.subject_kind = 'row' and c.subject_ref = 'core.files:' || f.file_id
on conflict (id) do nothing;

-- The count, row by row.

do $$
declare
  differing integer;
begin
  with old as (
    select user_id, ref, count(*) as n from public.dev_comment_refs group by user_id, ref
    union all
    select user_id, 'core.files:' || file_id, count(*) from core.file_comments group by user_id, file_id
  ),
  copied as (
    select t.user_id, t.ref, count(*) as n
      from core.thread_turns t
     where t.id in (select id from public.dev_comments union all select id from core.file_comments)
     group by t.user_id, t.ref
  )
  select count(*) into differing
    from old full join copied using (user_id, ref)
   where old.n is distinct from copied.n;

  if differing > 0 then
    raise exception 'copy_threads: % rows have a different number of comments after the copy', differing;
  end if;
end;
$$;

-- Its work is done; nothing reads it after this file.
drop view public.dev_comment_refs;

comment on table public.dev_comments is
  'Read-only since plan #1470: its threads are in core.conversations under each row''s ref. Kept until the person says it can go, after 30 days.';
comment on table core.file_comments is
  'Read-only since plan #1470: its threads are in core.conversations under core.files:<id>. Kept until the person says it can go, after 30 days.';

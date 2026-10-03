-- A conversation can sit under any row, named by its ref (plan #1468).
--
-- docs/CORE-AND-DASH-SPEC.md, Part 2: core.conversations becomes the one
-- thread store. Its kinds become two:
--
--   row   subject_ref is a ref, `schema.table:id` (Part 1), naming the row
--         the thread sits under. One thread per user and row, which the
--         unique index on (user_id, subject_kind, subject_ref) already gives.
--   ask   unchanged: an Ask Dash conversation, whose ref is its own id (0109).
--
-- The two kinds that came before are rewritten as row threads:
--
--   feed_card    subject_ref was the learn.feed_cards id, and becomes
--                `learn.feed_cards:<id>`.
--   news_story   subject_ref was `<issue id>:<story index>`. A story is a
--                position in news.issues.stories, not a row, but discussing
--                one saves it to news.saved_stories (plan #1061), so the
--                thread now sits under that saved row:
--                `news.saved_stories:<id>`, found by issue and headline, the
--                key saved_stories is unique on. A news_story thread with no
--                saved row to move to stops this migration rather than being
--                lost. news.saved_stories is created by a later folder
--                (migrations-news), so on a fresh database there is nothing
--                to move and the step is skipped.
--
-- A row thread's ref is checked on write by core.refs_check (0156), the same
-- trigger the other ref columns use: it must name a row of the writer's own,
-- in a table with an id and a user_id. The rewrite above runs before the
-- trigger exists, so a thread whose card has since gone keeps its turns.

set search_path = core, public, extensions;

-- The old list of kinds would refuse the rewrite, so it goes first.
alter table core.conversations drop constraint conversations_kind_ck;

update core.conversations
   set subject_kind = 'row', subject_ref = 'learn.feed_cards:' || subject_ref
 where subject_kind = 'feed_card';

do $$
declare
  left_over integer;
begin
  if to_regclass('news.saved_stories') is not null then
    execute $q$
      update core.conversations c
         set subject_kind = 'row', subject_ref = 'news.saved_stories:' || s.id
        from news.saved_stories s
       where c.subject_kind = 'news_story'
         and s.user_id = c.user_id
         and s.issue_id::text = split_part(c.subject_ref, ':', 1)
         and s.headline = btrim(c.title)
    $q$;
  end if;

  select count(*) into left_over from core.conversations where subject_kind = 'news_story';
  if left_over > 0 then
    raise exception 'conversation_rows: % news_story threads have no saved story to move under', left_over;
  end if;
end;
$$;

alter table core.conversations
  add constraint conversations_kind_ck check (subject_kind in ('row', 'ask'));

-- The shape of a ref; whose row it names is the trigger's to check.
alter table core.conversations
  add constraint conversations_row_ref_ck check (
    subject_kind <> 'row'
    or subject_ref ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*:[^[:space:]]+$'
  );

-- core.refs_check from 0156, with core.conversations added: a row thread's
-- subject_ref is its one ref, and an ask conversation holds none.
create or replace function core.refs_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_refs text[];
  old_refs text[] := '{}';
  ref text;
begin
  if tg_table_name = 'files' then
    new_refs := array_remove(array[new.origin], null);
    if tg_op = 'UPDATE' then old_refs := array_remove(array[old.origin], null); end if;
  elsif tg_table_name = 'observations' then
    new_refs := coalesce(new.evidence, '{}');
    if tg_op = 'UPDATE' then old_refs := coalesce(old.evidence, '{}'); end if;
  elsif tg_table_name = 'week_reviews' then
    new_refs := core.evidence_refs(new.observations);
    if tg_op = 'UPDATE' then old_refs := core.evidence_refs(old.observations); end if;
  elsif tg_table_name = 'year_reviews' then
    new_refs := core.evidence_refs(new.paragraphs);
    if tg_op = 'UPDATE' then old_refs := core.evidence_refs(old.paragraphs); end if;
  elsif tg_table_name = 'conversations' then
    new_refs := case when new.subject_kind = 'row' then array[new.subject_ref] else '{}'::text[] end;
    if tg_op = 'UPDATE' and old.subject_kind = 'row' then old_refs := array[old.subject_ref]; end if;
  else
    return new;
  end if;

  -- A row moved to another account keeps nothing it held before.
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    old_refs := '{}';
  end if;

  foreach ref in array new_refs loop
    continue when ref = any (old_refs);
    if not core.ref_owned(ref, new.user_id) then
      raise exception 'refs: % is not a row of yours', ref
        using errcode = 'check_violation', constraint = 'refs_owned';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function core.refs_check() from public, anon, authenticated;

create or replace trigger conversations_refs_check
  before insert or update of subject_kind, subject_ref, user_id on core.conversations
  for each row execute function core.refs_check();

comment on table core.conversations is
  'The one thread store (docs/CORE-AND-DASH-SPEC.md Part 2): a thread under any row, subject_kind ''row'' with subject_ref its ref (plan #1468), or an Ask Dash conversation, subject_kind ''ask'' with subject_ref its own id (plan #1086).';

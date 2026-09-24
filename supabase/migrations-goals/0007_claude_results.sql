-- ===========================================================================
-- What Claude produced for a step, and whether you have looked at it
-- (plan #933).
--
-- docs/GOALS-SPEC.md, "What Claude does, and when": each morning the goals
-- routine works the ready `claude` steps, such as a research note or a draft.
-- A Claude step closes when what it produced is stored and linked on the step,
-- and a finished draft sits in the home's waiting-on-you list until you have
-- read it.
--
--   result       the note or draft itself, as text. Only a `claude` step has
--                one.
--   result_url   where it lives when it is somewhere else as well, such as a
--                document or a page it found.
--   reviewed_at  when you marked it read. Null while it is waiting on you.
--
-- Reviewing is yours: a write that says it is Claude's may not set or clear
-- reviewed_at, in the same way it may not answer a question (0006).
-- ===========================================================================

alter table goals.items
  add column result text,
  add column result_url text,
  add column reviewed_at timestamptz;

alter table goals.items
  add constraint items_result_kind_ck check (
    (result is null and result_url is null) or kind = 'claude'
  ),
  add constraint items_result_length_ck check (
    result is null or (btrim(result) <> '' and length(result) <= 100000)
  ),
  add constraint items_result_url_ck check (
    result_url is null or (result_url ~* '^https?://' and length(result_url) <= 2000)
  ),
  add constraint items_reviewed_at_ck check (
    reviewed_at is null or result is not null or result_url is not null
  );

-- The home reads Claude's unreviewed results on every visit.
create index items_user_unreviewed_idx on goals.items (user_id)
  where kind = 'claude' and reviewed_at is null and archived_at is null
    and (result is not null or result_url is not null);

create or replace function goals.items_review_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') <> 'claude' then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.reviewed_at is not null)
     or (tg_op = 'UPDATE' and new.reviewed_at is distinct from old.reviewed_at) then
    raise exception 'Claude may not mark a result reviewed: only you do that.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_review_guard() from public, anon, authenticated;

create trigger items_review_guard before insert or update on goals.items
  for each row execute function goals.items_review_guard();

-- ===========================================================================
-- Putting a question aside (plan #956).
--
-- docs/GOALS-SPEC.md, "Taken from the dev plan": a question on a goal offers
-- Not now beside its options, as a decision on the dev plan does. Not now
-- leaves the question open and unanswered and takes it out of sight until you
-- bring it back.
--
--   items.dismissed_at  when you put the question aside; null while it is in
--                       view. Only a question that has no answer yet can be
--                       put aside, and answering one clears it.
--
-- Putting a question aside is yours, as answering it is (0006): a write that
-- says it is Claude's may not set or clear it.
-- ===========================================================================

alter table goals.items
  add column dismissed_at timestamptz;

alter table goals.items
  add constraint items_dismissed_question_ck check (
    dismissed_at is null or (kind = 'decision' and resolution is null)
  );

create or replace function goals.items_dismiss_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') <> 'claude' then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.dismissed_at is not null)
     or (tg_op = 'UPDATE' and new.dismissed_at is distinct from old.dismissed_at) then
    raise exception 'Claude may not put a question aside or bring one back: only you do that.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_dismiss_guard() from public, anon, authenticated;

create trigger items_dismiss_guard before insert or update on goals.items
  for each row execute function goals.items_dismiss_guard();

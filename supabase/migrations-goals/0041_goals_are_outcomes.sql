-- ===========================================================================
-- A goal is an outcome, not a practice (docs/GOALS-SPEC.md, "The three
-- levels").
--
-- "Go to one urbanism event a week" was proposed and approved as a goal. It
-- is a practice: it never ends, and it is only worth doing for what it leads
-- to. A goal names the outcome ("Know ten people in the scene by name") and
-- the practice sits inside it as a rhythm step.
--
-- goals.reads_as_practice says whether a title or done-when reads as a rate
-- ("a week", "three times a month", "every morning", "weekly") or a streak
-- ("kept for eight of the last ten weeks"). "A week" after within, in, by,
-- for, after, than, over, under or about is a deadline, not a rate, and
-- passes. It is readsAsPractice in lib/goals/tree.ts in SQL; the two must
-- agree. The app refuses such a goal from you with the same test and says
-- what to write instead; the trigger below refuses it from Claude
-- (goals.actor = 'claude'), on a goal it proposes or an edit to one.
-- ===========================================================================

create or replace function goals.reads_as_practice(text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(text ~* '\m(?:(?:every|each|per)\s+(?:day|week|month|weekday|weekend|morning|evening|night)|(?<!\m(?:within|in|by|for|after|than|over|under|about)\s)a\s+(?:day|week|month)|kept\s+for|daily|weekly|monthly|nightly)\M', false);
$$;

revoke all on function goals.reads_as_practice(text) from public, anon;
grant execute on function goals.reads_as_practice(text) to authenticated, service_role;

create or replace function goals.items_outcome_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.level <> 'goal'
     or coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') <> 'claude' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.title is not distinct from old.title
     and new.acceptance is not distinct from old.acceptance then
    return new;
  end if;
  if goals.reads_as_practice(new.title) or goals.reads_as_practice(new.acceptance) then
    raise exception 'A goal is an outcome, not a practice: "%" reads as something done again and again. Name the outcome it serves as the goal, and put the practice inside it as a rhythm step.', new.title
      using errcode = 'check_violation', constraint = 'items_goal_is_outcome';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_outcome_guard() from public, anon, authenticated;

create trigger items_outcome_guard before insert or update of title, acceptance on goals.items
  for each row execute function goals.items_outcome_guard();

-- ===========================================================================
-- Reactions to Claude's suggestions are yours (plan #934).
--
-- docs/GOALS-SPEC.md, "What Claude does, and when": once a week the goals
-- routine researches city events, talks and volunteer openings for your
-- rhythm goals and writes each one to goals.suggestions (0001). Each has
-- going and not for me buttons, and what you pressed is what the next week's
-- research reads.
--
-- So the reaction has to be yours. A write that says it is Claude's (the
-- `goals.actor` setting or the x-goals-actor header, as in 0006) may insert a
-- suggestion only with no reaction and nothing about whether you went, and
-- may change a reaction in one way only: from none to `ignored`, which the
-- weekly run writes for a suggestion nobody reacted to within the week.
-- Whether you went (`attended`) is never Claude's to write.
-- ===========================================================================

create or replace function goals.suggestions_claude_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') <> 'claude' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.reaction is not null or new.attended is not null then
      raise exception 'Claude may suggest but not react: insert a suggestion with no reaction and no attended.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.reaction is distinct from old.reaction
     and not (old.reaction is null and new.reaction = 'ignored') then
    raise exception 'Claude may not react to a suggestion: only an unanswered one may be marked ignored.'
      using errcode = 'check_violation';
  end if;

  if new.attended is distinct from old.attended then
    raise exception 'Claude may not record whether you went.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function goals.suggestions_claude_guard() from public, anon, authenticated;

create trigger suggestions_claude_guard before insert or update on goals.suggestions
  for each row execute function goals.suggestions_claude_guard();

-- The weekly run reads the unanswered ones to mark ignored, and the Todo
-- agenda reads the ones marked going, on every load.
create index suggestions_user_reaction_idx on goals.suggestions (user_id, reaction, created_at desc);

-- ===========================================================================
-- Help kinds Claude proposes when it maps a goal (plan #1029).
--
-- A goal's weekly help (items.help_kinds, 0019) is the person's choice. When
-- Claude maps a goal it now proposes the kinds that fit it, and the goal page
-- shows them to approve, change or turn down:
--
--   items.proposed_help_kinds  the kinds Claude proposed, the same shape as
--                              help_kinds and checked the same way. Empty
--                              when nothing is waiting. Only a goal carries
--                              entries.
--   items.help_kinds_settled_at  when the person last saved the goal's weekly
--                              help: approved a proposal, changed it, turned
--                              it down, or chose kinds on their own. Null
--                              while they never have. Claude proposes only
--                              while it is null, so a proposal turned down is
--                              not made again on the next run.
--
-- A goal that already has kinds chosen before this migration counts as
-- settled, so mapping it again proposes nothing.
--
-- The guard below keeps the choice the person's: a write that says it is
-- Claude's may not change help_kinds or help_kinds_settled_at, and may only
-- write a proposal on a goal whose help has never been settled. Clearing a
-- proposal is always allowed.
-- ===========================================================================

alter table goals.items
  add column proposed_help_kinds jsonb not null default '[]'::jsonb,
  add column help_kinds_settled_at timestamptz;

alter table goals.items
  add constraint items_proposed_help_kinds_ck check (
    goals.help_kinds_valid(proposed_help_kinds)
    and (level = 'goal' or proposed_help_kinds = '[]'::jsonb)
  );

update goals.items
set help_kinds_settled_at = updated_at
where level = 'goal' and help_kinds <> '[]'::jsonb;

create or replace function goals.items_help_guard()
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
    if new.help_kinds <> '[]'::jsonb or new.help_kinds_settled_at is not null then
      raise exception 'Claude may not choose a goal''s weekly help: write it to proposed_help_kinds instead.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.help_kinds is distinct from old.help_kinds
     or new.help_kinds_settled_at is distinct from old.help_kinds_settled_at then
    raise exception 'Claude may not choose a goal''s weekly help: write it to proposed_help_kinds instead.'
      using errcode = 'check_violation';
  end if;
  if new.proposed_help_kinds is distinct from old.proposed_help_kinds
     and new.proposed_help_kinds <> '[]'::jsonb
     and old.help_kinds_settled_at is not null then
    raise exception 'The person has already settled this goal''s weekly help, so propose none.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function goals.items_help_guard() from public, anon, authenticated;

create trigger items_help_guard before insert or update on goals.items
  for each row execute function goals.items_help_guard();

comment on column goals.items.proposed_help_kinds is
  'Weekly help Claude proposed when mapping the goal (plan #1029), the same shape as help_kinds; empty when nothing is waiting. Empty on steps.';
comment on column goals.items.help_kinds_settled_at is
  'When the person last saved the goal''s weekly help: approved, changed or turned down a proposal, or chose kinds themselves (plan #1029). Null while never; Claude proposes only then.';

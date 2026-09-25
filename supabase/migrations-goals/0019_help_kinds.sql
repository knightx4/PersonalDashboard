-- ===========================================================================
-- The kinds of weekly help a goal asks for (plan #1027).
--
-- The weekly run researches one thing, NYC events, and only for rhythm
-- goals. Each goal now names the help it wants instead, so a volunteering
-- goal can get volunteer openings and a learning goal can get reading:
--
--   items.help_kinds   a JSON array of {"kind": …, "note": …}, one entry per
--                      kind of help, in the order they were chosen. kind is
--                      one of events, volunteering, reading, courses and
--                      job_leads, at most once each. note says what to look
--                      for ("Brooklyn, weeknights"), up to 200 characters,
--                      or is null. An empty array asks for nothing. Only a
--                      goal carries entries; a step's array stays empty.
--
-- The set of kinds lives in the app too (lib/goals/help-kinds.ts). Adding a
-- kind means changing both, and the check below keeps a kind the app does
-- not know from reaching the weekly run's brief.
-- ===========================================================================

create or replace function goals.help_kinds_valid(value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  entry jsonb;
  seen text[] := '{}';
  entry_kind text;
begin
  if value is null or jsonb_typeof(value) <> 'array' then
    return false;
  end if;
  for entry in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(entry) <> 'object' then
      return false;
    end if;
    if exists (
      select 1 from jsonb_object_keys(entry) as k where k not in ('kind', 'note')
    ) then
      return false;
    end if;
    entry_kind := entry ->> 'kind';
    if entry_kind is null
       or entry_kind not in ('events', 'volunteering', 'reading', 'courses', 'job_leads')
       or entry_kind = any (seen)
    then
      return false;
    end if;
    seen := seen || entry_kind;
    if entry ? 'note' and jsonb_typeof(entry -> 'note') <> 'null' then
      if jsonb_typeof(entry -> 'note') <> 'string'
         or char_length(entry ->> 'note') > 200
      then
        return false;
      end if;
    end if;
  end loop;
  return true;
end;
$$;

alter table goals.items
  add column help_kinds jsonb not null default '[]'::jsonb;

alter table goals.items
  add constraint items_help_kinds_ck check (
    goals.help_kinds_valid(help_kinds)
    and (level = 'goal' or help_kinds = '[]'::jsonb)
  );

comment on column goals.items.help_kinds is
  'The kinds of weekly help a goal asks for (plan #1027): an array of {kind, note}, kind one of events, volunteering, reading, courses, job_leads at most once each, note what to look for or null. Empty on steps.';

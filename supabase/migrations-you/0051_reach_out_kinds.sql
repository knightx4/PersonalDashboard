-- Fixed watch kinds in a reach-out rule (plan #3030.3, under #3030).
--
-- A watch in you.board_advisors.reach_out_rule may now name a fixed kind
-- that the daily round reads with its own reader (lib/you/reach-out-kinds.ts):
-- newsletter issues, stories on a topic, a charge over an amount, a balance
-- under one, a card statement due, a new or dearer recurring payment, the
-- day's schedule, overdue todos, a new appointment, a return window closing,
-- a delivery due, mail from a sender or about a subject, new Learn videos,
-- review questions waiting and a goal the review marked stalled. Three
-- optional keys on a watch:
--
--   "kind": "charge_over"         [a-z][a-z0-9_]*, up to 40; which kinds
--                                 exist is checked where the rule is
--                                 written, as for tables
--   "params": {                   what the kind is told, each optional:
--     "words": ["AI"],            one to eight, 1 to 60 characters
--     "amount": 2000,             above 0, up to 10,000,000, in major units
--     "days": 7,                  a whole number from 1 to 90
--     "from": "Monzo"             1 to 200 characters
--   }
--   "always": true                text at the cadence even when nothing is new
--
-- Everything else about the shape is as 0044 wrote it. Every rule already
-- saved passes, since the new keys are optional.
--
-- Schema change only. No row of any account is written.

set search_path = you, public, extensions;

create or replace function you.reach_out_rule_valid(rule jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  watch jsonb;
  item jsonb;
  params jsonb;
  keys text[] := '{}';
  table_name text;
begin
  if rule is null then
    return true;
  end if;
  if jsonb_typeof(rule) <> 'object' then
    return false;
  end if;
  if exists (
    select 1 from jsonb_object_keys(rule) k where k not in ('version', 'watches', 'cannot_watch')
  ) then
    return false;
  end if;
  if rule -> 'version' is distinct from '1'::jsonb then
    return false;
  end if;

  if jsonb_typeof(rule -> 'watches') is distinct from 'array'
     or jsonb_array_length(rule -> 'watches') not between 1 and 8 then
    return false;
  end if;

  for watch in select value from jsonb_array_elements(rule -> 'watches') loop
    if jsonb_typeof(watch) <> 'object' then
      return false;
    end if;
    if exists (
      select 1 from jsonb_object_keys(watch) k
       where k not in ('key', 'about', 'tables', 'mode', 'every_days', 'repeat_after_days', 'form', 'kind', 'params', 'always')
    ) then
      return false;
    end if;

    if jsonb_typeof(watch -> 'key') is distinct from 'string'
       or (watch ->> 'key') !~ '^[a-z][a-z0-9_]{0,39}$'
       or (watch ->> 'key') = any (keys) then
      return false;
    end if;
    keys := keys || (watch ->> 'key');

    if jsonb_typeof(watch -> 'about') is distinct from 'string'
       or char_length(btrim(watch ->> 'about')) not between 1 and 200 then
      return false;
    end if;

    if jsonb_typeof(watch -> 'tables') is distinct from 'array'
       or jsonb_array_length(watch -> 'tables') not between 1 and 6 then
      return false;
    end if;
    for item in select value from jsonb_array_elements(watch -> 'tables') loop
      if jsonb_typeof(item) <> 'string' then
        return false;
      end if;
      table_name := item #>> '{}';
      if table_name !~ '^[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62}$' then
        return false;
      end if;
    end loop;
    if (select count(distinct value) from jsonb_array_elements(watch -> 'tables'))
       <> jsonb_array_length(watch -> 'tables') then
      return false;
    end if;

    if jsonb_typeof(watch -> 'mode') is distinct from 'string'
       or (watch ->> 'mode') not in ('each', 'roundup', 'pick') then
      return false;
    end if;

    if jsonb_typeof(watch -> 'every_days') is distinct from 'number'
       or (watch ->> 'every_days')::numeric <> trunc((watch ->> 'every_days')::numeric)
       or (watch ->> 'every_days')::numeric not between 1 and 90 then
      return false;
    end if;

    -- Present, and null for never or a whole number of days.
    if not (watch ? 'repeat_after_days') then
      return false;
    end if;
    if jsonb_typeof(watch -> 'repeat_after_days') <> 'null' and (
         jsonb_typeof(watch -> 'repeat_after_days') <> 'number'
         or (watch ->> 'repeat_after_days')::numeric <> trunc((watch ->> 'repeat_after_days')::numeric)
         or (watch ->> 'repeat_after_days')::numeric not between 1 and 3650
       ) then
      return false;
    end if;

    if watch ? 'form' and (
         jsonb_typeof(watch -> 'form') <> 'string' or (watch ->> 'form') not in ('list', 'bubbles')
       ) then
      return false;
    end if;

    -- A fixed watch kind (plan #3030.3): its name, what it is told, and
    -- whether it texts even when nothing is new.
    if watch ? 'kind' and (
         jsonb_typeof(watch -> 'kind') <> 'string' or (watch ->> 'kind') !~ '^[a-z][a-z0-9_]{0,39}$'
       ) then
      return false;
    end if;
    if watch ? 'always' and jsonb_typeof(watch -> 'always') <> 'boolean' then
      return false;
    end if;
    if watch ? 'params' then
      params := watch -> 'params';
      if jsonb_typeof(params) <> 'object' then
        return false;
      end if;
      if exists (
        select 1 from jsonb_object_keys(params) k where k not in ('words', 'amount', 'days', 'from')
      ) then
        return false;
      end if;
      if params ? 'words' then
        if jsonb_typeof(params -> 'words') <> 'array'
           or jsonb_array_length(params -> 'words') not between 1 and 8 then
          return false;
        end if;
        for item in select value from jsonb_array_elements(params -> 'words') loop
          if jsonb_typeof(item) <> 'string' or char_length(btrim(item #>> '{}')) not between 1 and 60 then
            return false;
          end if;
        end loop;
      end if;
      if params ? 'amount' and (
           jsonb_typeof(params -> 'amount') <> 'number'
           or (params ->> 'amount')::numeric <= 0
           or (params ->> 'amount')::numeric > 10000000
         ) then
        return false;
      end if;
      if params ? 'days' and (
           jsonb_typeof(params -> 'days') <> 'number'
           or (params ->> 'days')::numeric <> trunc((params ->> 'days')::numeric)
           or (params ->> 'days')::numeric not between 1 and 90
         ) then
        return false;
      end if;
      if params ? 'from' and (
           jsonb_typeof(params -> 'from') <> 'string' or char_length(btrim(params ->> 'from')) not between 1 and 200
         ) then
        return false;
      end if;
    end if;
  end loop;

  if rule ? 'cannot_watch' then
    if jsonb_typeof(rule -> 'cannot_watch') <> 'array'
       or jsonb_array_length(rule -> 'cannot_watch') > 8 then
      return false;
    end if;
    for item in select value from jsonb_array_elements(rule -> 'cannot_watch') loop
      if jsonb_typeof(item) <> 'string' or char_length(btrim(item #>> '{}')) not between 1 and 200 then
        return false;
      end if;
    end loop;
  end if;

  return true;
end;
$$;

comment on function you.reach_out_rule_valid(jsonb) is
  'Whether a person''s reach-out rule has the version 1 shape: one to eight watches, each with a key, what it is about, the tables it reads, a mode, a cadence, a no-repeat window, and optionally a fixed kind with its params and whether it texts when nothing is new; and what the brief asked for that nothing can watch (plans #2931.1, #3030.3).';

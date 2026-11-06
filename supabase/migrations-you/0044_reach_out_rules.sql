-- Each person on People keeps what to text you about (plan #2931.1, under #2931).
--
-- On a person's edit form you write, in your own words, what they should
-- text you about and how often. Dash turns that into a rule it can check
-- (#2931.2) and the daily round follows it (#2931.5). This migration keeps
-- the words, the rule and every row a text has named, so a later round can
-- tell what is new.
--
-- 1. you.board_advisors gains
--
--   reach_out_brief     what you wrote, as you wrote it; null for a person
--                       with no brief, who keeps today's behaviour
--   reach_out_rule      the rule Dash made of it, in the shape below; null
--                       until one is made
--   reach_out_summary   the plain sentence the Set up card shows; present
--                       whenever a rule is
--   reach_out_set_at    when the rule (or the error) was last written
--   reach_out_error     why the brief could not be made into a rule, in
--                       words the card can show; null when it could
--
-- 2. you.reach_out_rule_valid(rule), which the check on reach_out_rule
-- calls, so a malformed rule cannot be saved. The shape, version 1:
--
--   {
--     "version": 1,
--     "watches": [                      one to eight
--       {
--         "key": "new_roles",           [a-z][a-z0-9_]*, up to 40, unique in the rule
--         "about": "New roles that fit you",   plain words, 1 to 200
--         "tables": ["job_search.roles"],      one to six schema.table names
--         "mode": "each",               each (a text per new row), roundup
--                                       (one text about the rows since the
--                                       last) or pick (one row, now and then)
--         "every_days": 7,              how often, 1 to 90 days
--         "repeat_after_days": null,    how long before the same row may be
--                                       named again, 1 to 3650 days; null
--                                       for never
--         "form": "list"                optional: list or bubbles
--       }
--     ],
--     "cannot_watch": ["..."]           what the brief asked for that no
--                                       table holds; zero to eight, 1 to 200
--   }
--
-- No other key is accepted at either level. Which tables a rule may name is
-- the sources catalogue's business (lib/sources), checked where the rule is
-- written; here a table name has only to look like one.
--
-- 3. you.advisor_reach_outs: one row per row a text named. The no-repeat
-- check reads it by (user_id, advisor_id, ref_table, ref_id, sent_at).
--
--   advisor_id    the person on People who sent it
--   message_id    the text (you.advisor_messages); set null if the message
--                 goes, so the memory of what was named outlives the thread
--   watch_key     the watch in their rule it was sent under
--   ref_table     the row's table, schema.table
--   ref_id        the row's id, as text (a vault note's ref is its path)
--   sent_at       when the text was sent
--
-- Written by the daily round with the service role; the person reads their
-- own rows.
--
-- Schema change only. No row of any account is written.

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 2. The rule's shape. Defined first, since the column's check calls it.
-- ---------------------------------------------------------------------------

create or replace function you.reach_out_rule_valid(rule jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  watch jsonb;
  item jsonb;
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
       where k not in ('key', 'about', 'tables', 'mode', 'every_days', 'repeat_after_days', 'form')
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
  'Whether a person''s reach-out rule has the version 1 shape: one to eight watches, each with a key, what it is about, the tables it reads, a mode, a cadence and a no-repeat window, and what the brief asked for that nothing can watch (plan #2931.1).';

revoke all on function you.reach_out_rule_valid(jsonb) from public, anon;
grant execute on function you.reach_out_rule_valid(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. The brief, the rule and the card's sentence.
-- ---------------------------------------------------------------------------

alter table you.board_advisors
  add column reach_out_brief text
    constraint board_advisors_reach_out_brief_ck
      check (reach_out_brief is null or char_length(btrim(reach_out_brief)) between 1 and 2000),
  add column reach_out_rule jsonb
    constraint board_advisors_reach_out_rule_ck
      check (you.reach_out_rule_valid(reach_out_rule)),
  add column reach_out_summary text
    constraint board_advisors_reach_out_summary_ck
      check (reach_out_summary is null or char_length(btrim(reach_out_summary)) between 1 and 600),
  add column reach_out_set_at timestamptz,
  add column reach_out_error text
    constraint board_advisors_reach_out_error_ck
      check (reach_out_error is null or char_length(btrim(reach_out_error)) between 1 and 600),
  add constraint board_advisors_reach_out_rule_summary_ck
    check (reach_out_rule is null or reach_out_summary is not null);

comment on column you.board_advisors.reach_out_brief is
  'What the person wrote about what this person on People should text them about and how often, in their own words; null keeps the daily round''s own judgement (plan #2931.1).';
comment on column you.board_advisors.reach_out_rule is
  'The rule Dash made from reach_out_brief, in the shape you.reach_out_rule_valid checks; null until one is made (plan #2931.1).';
comment on column you.board_advisors.reach_out_summary is
  'The plain sentence the Set up card shows for reach_out_rule: what Dash understood, what it cannot watch, and when the first text should come (plan #2931.1).';
comment on column you.board_advisors.reach_out_set_at is
  'When reach_out_rule or reach_out_error was last written (plan #2931.1).';
comment on column you.board_advisors.reach_out_error is
  'Why reach_out_brief could not be made into a rule, in words the card can show; null when it could (plan #2931.1).';

-- ---------------------------------------------------------------------------
-- 3. Every row a text has named.
-- ---------------------------------------------------------------------------

create table you.advisor_reach_outs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  advisor_id uuid not null,
  message_id uuid,
  watch_key text not null,
  ref_table text not null,
  ref_id text not null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint advisor_reach_outs_watch_key_ck check (watch_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint advisor_reach_outs_ref_table_ck
    check (ref_table ~ '^[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62}$'),
  constraint advisor_reach_outs_ref_id_ck check (char_length(ref_id) between 1 and 400),
  constraint advisor_reach_outs_message_ref unique (message_id, ref_table, ref_id),
  foreign key (advisor_id, user_id)
    references you.board_advisors (id, user_id) on delete cascade,
  foreign key (message_id, user_id)
    references you.advisor_messages (id, user_id) on delete set null (message_id)
);

comment on table you.advisor_reach_outs is
  'One row per row a text from someone on People named, so the daily round never names it again inside their rule''s no-repeat window (plan #2931.1).';
comment on column you.advisor_reach_outs.watch_key is
  'The key of the watch in the sender''s reach_out_rule the text was sent under (plan #2931.1).';
comment on column you.advisor_reach_outs.ref_table is
  'The named row''s table, as schema.table (plan #2931.1).';
comment on column you.advisor_reach_outs.ref_id is
  'The named row''s id as text; a vault note''s is its path (plan #2931.1).';
comment on column you.advisor_reach_outs.message_id is
  'The text that named it; null once that message is gone, so the memory outlives the thread (plan #2931.1).';

create index advisor_reach_outs_repeat_idx
  on you.advisor_reach_outs (user_id, advisor_id, ref_table, ref_id, sent_at desc);
create index advisor_reach_outs_message_idx on you.advisor_reach_outs (message_id) where message_id is not null;

alter table you.advisor_reach_outs enable row level security;

create policy advisor_reach_outs_select on you.advisor_reach_outs for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on you.advisor_reach_outs from anon, authenticated;
grant select on you.advisor_reach_outs to authenticated;
grant select, insert, update, delete on you.advisor_reach_outs to service_role;

notify pgrst, 'reload schema';

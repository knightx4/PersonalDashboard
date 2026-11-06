-- People text first when something happens (plan #2854.1, under #2854).
--
-- A person on People can text unasked when something on the plan matters:
-- a step needs the person, a question is waiting for their answer, a build
-- shipped, a build failed or stalled. lib/you/first-texts.ts holds each
-- person's rule (which of these they text about, how many texts a day, how a
-- batch is worded); this migration keeps what happened and what was sent.
--
-- 1. you.first_text_events
--
-- One row per thing worth a text, written by the triggers in 3. The sweep
-- (inngest/you/first-texts.ts, from the five-minute council-texts job of
-- 0039) batches a person's open rows into one text and closes them:
--
--   kind          needs_you, question, shipped or failed
--   plan_item_id  the step it is about; plan_run_id the run, for failed
--   detail        for failed: 'failed' or 'stalled'
--   dedupe_key    one row per happening, so a trigger firing twice for it
--                 writes nothing the second time
--   closed_at     when it was texted, or closed unsent (stale, or of a kind
--                 the person switched off); null while it waits
--   message_id    the text's first bubble when it was texted
--
-- 2. Columns
--
--   you.board_advisors.text_when   what this person texts about, the list of
--                                  switches on their form; null for their
--                                  rule's defaults
--   you.advisor_messages.text_rule the rule a text_first came from; null for
--                                  the Council's daily notes
--
-- you.advisor_texts_cap (0039) keeps quiet hours for every text, and its
-- Council caps (one unread per mentor, six unread, three a day) now count
-- and hold the Council's texts alone. A rule's texts keep the rule's own
-- daily limit, checked by the sweep, with a backstop here of twelve bubbles
-- a day in one thread.
--
-- 3. Triggers on the plan, security definer so a change made by the person
-- through the app can write its event:
--
--   public.plan_items   a setup step added (needs_you), a build step that
--                       goes blocked (needs_you, once a day), a decision added
--                       or opened (question), a build step closed done
--                       (shipped)
--   public.plan_runs    a build run (a step, a feature or the queue) that
--                       turns failed or stale (failed)
--
-- Schema change only. No row of any account is written.

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. What happened.
-- ---------------------------------------------------------------------------

create table you.first_text_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  plan_item_id uuid references public.plan_items (id) on delete cascade,
  plan_run_id uuid references public.plan_runs (id) on delete set null,
  detail text,
  dedupe_key text not null,
  closed_at timestamptz,
  message_id uuid,
  created_at timestamptz not null default now(),

  constraint first_text_events_kind_ck check (kind in ('needs_you', 'question', 'shipped', 'failed')),
  constraint first_text_events_detail_ck check (detail is null or detail in ('failed', 'stalled')),
  constraint first_text_events_dedupe_key_ck check (char_length(dedupe_key) between 1 and 200),
  constraint first_text_events_dedupe_key unique (user_id, dedupe_key),
  foreign key (message_id, user_id)
    references you.advisor_messages (id, user_id) on delete set null (message_id)
);

comment on table you.first_text_events is
  'Things worth a text from someone on People, one row each, written by triggers on the plan; the sweep batches a person''s open rows into one text (plan #2854.1).';
comment on column you.first_text_events.kind is
  'needs_you (a step needs the person), question (a decision waits for their answer), shipped (a build step closed done) or failed (a run failed or went stale) (plan #2854.1).';
comment on column you.first_text_events.dedupe_key is
  'One row per happening: the kind and the row it is about, and the day for a step that goes blocked (plan #2854.1).';
comment on column you.first_text_events.closed_at is
  'When it was texted, or closed unsent; null while it waits for the next batch (plan #2854.1).';
comment on column you.first_text_events.message_id is
  'The first bubble of the text that told the person about it; null when it closed unsent (plan #2854.1).';

create index first_text_events_open_idx on you.first_text_events (user_id, created_at) where closed_at is null;
create index first_text_events_item_idx on you.first_text_events (plan_item_id) where plan_item_id is not null;
create index first_text_events_run_idx on you.first_text_events (plan_run_id) where plan_run_id is not null;
create index first_text_events_message_idx on you.first_text_events (message_id) where message_id is not null;

alter table you.first_text_events enable row level security;

create policy first_text_events_select on you.first_text_events for select to authenticated
  using (user_id = (select auth.uid()));

grant select on you.first_text_events to authenticated;
grant select, insert, update, delete on you.first_text_events to service_role;

-- ---------------------------------------------------------------------------
-- 2. What each person texts about, and which rule a text came from.
-- ---------------------------------------------------------------------------

alter table you.board_advisors
  add column text_when text[]
    check (text_when is null or text_when <@ array['needs_you', 'question', 'shipped', 'failed']::text[]);

comment on column you.board_advisors.text_when is
  'What this person texts first about, as the switches on their form set it; null for their rule''s defaults (plan #2854.1).';

alter table you.advisor_messages
  add column text_rule text
    check (text_rule is null or (kind = 'text_first' and char_length(text_rule) between 1 and 60));

comment on column you.advisor_messages.text_rule is
  'For a text_first: the rule in lib/you/first-texts.ts it was sent by, the person''s key; null for the Council''s daily notes (plan #2854.1).';

create or replace function you.advisor_texts_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  mentor uuid;
begin
  -- The text's own time, which is now() for a text a session sends; a test
  -- can date one to check either side of the hour.
  if you.quiet_hours(new.user_id, coalesce(new.created_at, now())) then
    raise exception 'Quiet hours: mentors do not text between 22:00 and 08:00.' using errcode = 'check_violation';
  end if;

  -- A rule's texts keep the rule's own daily limit (lib/you/first-texts.ts);
  -- this is the backstop should the sweep ever loop.
  if new.text_rule is not null then
    if (
      select count(*)
        from you.advisor_messages m
       where m.user_id = new.user_id
         and m.chat_id = new.chat_id
         and m.text_rule is not null
         and m.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
    ) >= 12 then
      raise exception 'Twelve texts in this thread today; nothing more until tomorrow.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select c.advisor_id into mentor
    from you.advisor_chats c
   where c.id = new.chat_id and c.user_id = new.user_id;

  if exists (
    select 1
      from you.advisor_messages m
      join you.advisor_chats c on c.id = m.chat_id and c.user_id = m.user_id
     where m.user_id = new.user_id
       and c.advisor_id = mentor
       and m.kind = 'text_first'
       and m.text_rule is null
       and m.read_at is null
       and (c.last_read_at is null or m.created_at > c.last_read_at)
  ) then
    raise exception 'This mentor already has an unread text.' using errcode = 'check_violation';
  end if;

  if (
    select count(*)
      from you.advisor_messages m
      join you.advisor_chats c on c.id = m.chat_id and c.user_id = m.user_id
     where m.user_id = new.user_id
       and m.kind = 'text_first'
       and m.text_rule is null
       and m.read_at is null
       and (c.last_read_at is null or m.created_at > c.last_read_at)
  ) >= 6 then
    raise exception 'Six mentor texts are unread; nothing new until some are read.' using errcode = 'check_violation';
  end if;

  if (
    select count(*)
      from you.advisor_messages m
     where m.user_id = new.user_id
       and m.kind = 'text_first'
       and m.text_rule is null
       and m.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
  ) >= 3 then
    raise exception 'The Council has sent three texts today.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function you.advisor_texts_cap() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The plan writes what happened.
-- ---------------------------------------------------------------------------

create or replace function you.plan_item_text_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was text := case when tg_op = 'UPDATE' then old.status else null end;
  ev_kind text;
  ev_key text;
begin
  if new.kind = 'setup' and new.status = 'not_started' and was is distinct from 'not_started' and (tg_op = 'INSERT' or was = 'proposed') then
    ev_kind := 'needs_you';
    ev_key := 'needs_you:' || new.id;
  elsif new.kind = 'build' and new.status = 'blocked' and was is distinct from 'blocked' then
    ev_kind := 'needs_you';
    ev_key := 'needs_you:' || new.id || ':' || to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  elsif new.kind = 'decision' and new.status = 'not_started' and was is distinct from 'not_started' and (tg_op = 'INSERT' or was = 'proposed') then
    ev_kind := 'question';
    ev_key := 'question:' || new.id;
  elsif new.kind = 'build' and new.status = 'done' and tg_op = 'UPDATE' and was is distinct from 'done' then
    ev_kind := 'shipped';
    ev_key := 'shipped:' || new.id;
  else
    return new;
  end if;

  insert into you.first_text_events (user_id, kind, plan_item_id, dedupe_key)
  values (new.user_id, ev_kind, new.id, ev_key)
  on conflict (user_id, dedupe_key) do nothing;
  return new;
end;
$$;

comment on function you.plan_item_text_event() is
  'Writes a you.first_text_events row when a plan step starts needing the person, a question is put to them, or a build step ships (plan #2854.1).';

revoke all on function you.plan_item_text_event() from public, anon, authenticated;

create trigger plan_items_text_event
  after insert or update of status on public.plan_items
  for each row execute function you.plan_item_text_event();

create or replace function you.plan_run_text_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  was text := case when tg_op = 'UPDATE' then old.status else null end;
begin
  -- Builds only: a step, a feature or the queue. A failed shaping or review
  -- run is not a build.
  if new.status not in ('failed', 'stale') or was is not distinct from new.status
     or new.job not in ('step', 'feature', 'queue') then
    return new;
  end if;
  insert into you.first_text_events (user_id, kind, plan_item_id, plan_run_id, detail, dedupe_key)
  values (
    new.user_id,
    'failed',
    new.plan_item_id,
    new.id,
    case when new.status = 'stale' then 'stalled' else 'failed' end,
    'failed:' || new.id
  )
  on conflict (user_id, dedupe_key) do nothing;
  return new;
end;
$$;

comment on function you.plan_run_text_event() is
  'Writes a you.first_text_events row when a plan run fails or goes stale (plan #2854.1).';

revoke all on function you.plan_run_text_event() from public, anon, authenticated;

create trigger plan_runs_text_event
  after insert or update of status on public.plan_runs
  for each row execute function you.plan_run_text_event();

notify pgrst, 'reload schema';

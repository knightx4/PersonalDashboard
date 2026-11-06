-- Mentors text you first (plan #2748.7, under #2748).
--
-- The Council's daily notes stop being cards on the Council tab and arrive
-- as texts in each mentor's thread: you.advisor_messages rows with
-- role = 'advisor' and kind = 'text_first' (0038). This migration moves the
-- caps the person asked for onto those rows, keeps them out of the night,
-- and sends each one to their phone.
--
-- 1. you.advisor_messages gains
--
--   pushed_at   when the phone notification for a text was sent, or found
--               nobody to send to. Null on a text not yet announced, which
--               is what the sweep below looks for.
--
-- 2. you.quiet_hours(user_id, at)
--
-- True from 22:00 to 08:00 in the person's time zone
-- (core.account_settings.timezone; UTC when unset or not a zone Postgres
-- knows). Nothing is texted or announced then.
--
-- 3. you.advisor_texts_cap(), before insert on you.advisor_messages, for
-- kind = 'text_first' only. It refuses a text written in quiet hours, and
-- holds the three caps 0037's trigger holds on you.council_notes:
--
--   one unread per mentor   a text is unread while its read_at is null and
--                           it is newer than the thread's last_read_at;
--   six unread in all;
--   three a day             counted on the UTC day, as 0037 counts it.
--
-- Replies and acks are untouched: a mentor answering the person is never
-- capped.
--
-- 4. The 'council-texts-five-minutes' pg_cron job calls
-- /api/cron/council-texts, which sends one notification per new text,
-- naming the mentor and its first line, outside quiet hours, and starts the
-- daily round once the person's morning begins (the daily cron fires at
-- 12:00 UTC, which is 07:00 in New York in winter). The origin and the
-- secret come from Supabase Vault under the names 0078 requires: app_origin
-- and cron_secret. Unschedule-then-schedule by name, so applying this twice
-- leaves one job, and guarded on the extensions so the local test database,
-- which has neither, still resets.
--
-- Schema change, plus pushed_at set on the owner's text_first rows that
-- already exist, so the first sweep does not announce old ones. No other
-- account's rows are written.

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. Which texts have been announced.
-- ---------------------------------------------------------------------------

alter table you.advisor_messages add column pushed_at timestamptz;

comment on column you.advisor_messages.pushed_at is
  'For a mentor''s text_first message: when its phone notification was sent, or found no phone to send to. Null until then (plan #2748.7).';

create index advisor_messages_unpushed_idx on you.advisor_messages (created_at)
  where kind = 'text_first' and pushed_at is null;

update you.advisor_messages
   set pushed_at = created_at
 where user_id = core.dev_owner_id()
   and kind = 'text_first'
   and pushed_at is null;

-- ---------------------------------------------------------------------------
-- 2. Quiet hours.
-- ---------------------------------------------------------------------------

create or replace function you.quiet_hours(p_user uuid, p_at timestamptz default now())
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  zone text;
  hour integer;
begin
  select s.timezone into zone from core.account_settings s where s.user_id = p_user;
  if zone is null or not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = zone) then
    zone := 'UTC';
  end if;
  hour := extract(hour from (p_at at time zone zone))::integer;
  return hour >= 22 or hour < 8;
end;
$$;

comment on function you.quiet_hours(uuid, timestamptz) is
  'True from 22:00 to 08:00 in the person''s time zone, when no mentor texts them (plan #2748.7).';

revoke all on function you.quiet_hours(uuid, timestamptz) from public, anon;
grant execute on function you.quiet_hours(uuid, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The caps, on texts.
-- ---------------------------------------------------------------------------

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
       and m.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
  ) >= 3 then
    raise exception 'The Council has sent three texts today.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function you.advisor_texts_cap() from public, anon, authenticated;

create trigger advisor_texts_cap
  before insert on you.advisor_messages
  for each row
  when (new.kind = 'text_first')
  execute function you.advisor_texts_cap();

-- ---------------------------------------------------------------------------
-- 4. The sweep that announces each text.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the council-texts schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'council-texts-five-minutes'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'council-texts-five-minutes',
      '*/5 * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/council-texts',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 55000
        )
      $job$
    )
  $schedule$;
end;
$$;

notify pgrst, 'reload schema';

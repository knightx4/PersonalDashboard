-- A browser task waits 3 minutes for a computer of the person's before a
-- cloud session takes it (plan #3040.4, under #3040).
--
-- A session hand-off marked browser_task (0311) is no longer started in the
-- cloud when it is kept. It stays pending so the runner on the person's PC or
-- Mac can claim it (core.claim_browser_task, 0312) and do it in their own
-- Chrome. Every minute /api/cron/browser-handoffs (inngest/core/browser-wait.ts)
-- starts the cloud session on each one still pending and unclaimed 3 minutes
-- after it was kept, and the bot says in the thread that no computer of the
-- person's took it, so it runs on public pages only.
--
--   core.release_stale_browser_claims()
--                a claim whose computer has gone quiet is let go: a pending
--                browser task claimed over 5 minutes ago by a computer that
--                has sent no heartbeat in the last 5 minutes goes back to
--                unclaimed. It has waited past the 3 minutes already, so the
--                same pass starts it in the cloud. A runner keeps its
--                heartbeat going while it works a task, so a long task in
--                Chrome is never let go while its runner is alive. Returns
--                how many were let go.
--   core.say_in_handoff_thread(handoff, text)
--                posts one line into the thread a session hand-off was
--                asked in: in an Ask Dash conversation as Dash's turn, in a
--                People chat as the bot that handed it on (its speaker in a
--                group), as core.flag_bot_handoff (0310) posts.
--
-- The hand-offs are the owner's alone here, so both functions read and write
-- only the rows of core.dev_owner_id(). The schedule calls the app, which
-- holds the routine's token. Schema only: no existing row is changed by this
-- file.

set search_path = core, public, extensions;

-- The sweep's read of tasks a claim may have gone quiet on.
create index if not exists dash_handoffs_browser_claimed_idx on core.dash_handoffs (user_id, claimed_at)
  where kind = 'session' and browser_task and status = 'pending' and claimed_by is not null;

create or replace function core.release_stale_browser_claims()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := core.dev_owner_id();
  v_count integer;
begin
  if v_owner is null then
    return 0;
  end if;

  update core.dash_handoffs h
     set claimed_by = null,
         claimed_at = null
   where h.user_id = v_owner
     and h.kind = 'session'
     and h.browser_task
     and h.status = 'pending'
     and h.claimed_by is not null
     and h.claimed_at < now() - interval '5 minutes'
     and not exists (
       select 1 from core.browser_runners r
        where r.machine = h.claimed_by
          and r.user_id = v_owner
          and r.last_seen_at > now() - interval '5 minutes'
     );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function core.release_stale_browser_claims() is
  'Lets go of the owner''s pending browser tasks claimed over 5 minutes ago by a computer with no heartbeat in 5 minutes, so the cloud session takes them (plan #3040.4).';

create or replace function core.say_in_handoff_thread(p_handoff uuid, p_text text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row core.dash_handoffs;
  v_kind text;
  v_speaker uuid;
  v_id uuid;
begin
  if p_text is null or btrim(p_text) = '' then
    raise exception 'there is nothing to say';
  end if;

  select * into v_row from core.dash_handoffs
   where id = p_handoff and kind = 'session' and user_id = core.dev_owner_id();
  if not found then
    return null;
  end if;

  if v_row.conversation_id is not null then
    if exists (
      select 1 from core.conversations c where c.id = v_row.conversation_id and c.user_id = v_row.user_id
    ) then
      insert into core.conversation_turns (conversation_id, user_id, role, body)
      values (v_row.conversation_id, v_row.user_id, 'assistant', btrim(p_text))
      returning id into v_id;
    end if;
  elsif v_row.advisor_chat_id is not null then
    select c.kind into v_kind from you.advisor_chats c where c.id = v_row.advisor_chat_id and c.user_id = v_row.user_id;
    if v_kind is not null then
      if v_kind = 'group' then
        v_speaker := v_row.advisor_id;
      end if;
      insert into you.advisor_messages (user_id, chat_id, role, kind, speaker_id, text)
      values (v_row.user_id, v_row.advisor_chat_id, 'advisor', 'reply', v_speaker, btrim(p_text))
      returning id into v_id;
    end if;
  end if;
  return v_id;
end;
$$;

comment on function core.say_in_handoff_thread(uuid, text) is
  'Posts one line into the thread an owner''s session hand-off was asked in, as Dash or as the bot that handed it on (plan #3040.4).';

revoke all on function core.release_stale_browser_claims() from public, anon, authenticated;
revoke all on function core.say_in_handoff_thread(uuid, text) from public, anon, authenticated;
grant execute on function core.release_stale_browser_claims() to service_role;
grant execute on function core.say_in_handoff_thread(uuid, text) to service_role;

-- The schedule: every minute, so a task is started in the cloud between 3
-- and 4 minutes after it was kept. The origin and the secret come from
-- Supabase Vault at fire time, under the names 0078 already requires
-- (app_origin, cron_secret), as 0260 reads them. Guarded so the local test
-- database, which has neither extension, still applies this file.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net')
  then
    raise notice
      'pg_cron/pg_net not available here -- skipping the browser task schedule. Expected on the local test database.';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'browser-handoffs-minute'
  $unschedule$;

  execute $schedule$
    select cron.schedule(
      'browser-handoffs-minute',
      '* * * * *',
      $job$
        select net.http_post(
          url := (
            select decrypted_secret from vault.decrypted_secrets where name = 'app_origin'
          ) || '/api/cron/browser-handoffs',
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

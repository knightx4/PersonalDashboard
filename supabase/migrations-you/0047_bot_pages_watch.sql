-- Nothing a bot was asked to make goes quiet (plan #2997).
--
-- A bot that hands a page to the routine (core.dash_handoffs, kind 'page',
-- core migration 0305) says it is on it. These functions make sure the
-- thread hears again either way:
--
--   you.bot_page_say(handoff, text)  posts one message into the page's
--                    thread as the bot that was asked: in a group, with the
--                    bot as its speaker.
--   you.tell_bot_page(handoff)       when the page failed and the thread has
--                    not been told, says so with the reason and sets told_at.
--                    The routine calls it after marking a page failed.
--   you.watch_bot_pages()            every two minutes: a page still going
--                    after 20 minutes gets one "still working on it"; one
--                    still going after 90 is marked failed and the thread is
--                    told. Across accounts, so only the cron job runs it.
--
-- Each message is written to the row's own account, from the row's own
-- user_id. Schema and schedule only: no existing row is changed.

set search_path = you, public, extensions;

create or replace function you.bot_page_say(p_handoff uuid, p_text text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row core.dash_handoffs;
  v_kind text;
  v_speaker uuid;
  v_id uuid;
begin
  select * into v_row from core.dash_handoffs where id = p_handoff and kind = 'page';
  if not found then
    return null;
  end if;
  select c.kind into v_kind from you.advisor_chats c where c.id = v_row.advisor_chat_id and c.user_id = v_row.user_id;
  if v_kind is null then
    -- The thread is gone: there is nobody to tell.
    return null;
  end if;
  if v_kind = 'group' and exists (
    select 1 from you.board_advisors a where a.id = v_row.advisor_id and a.user_id = v_row.user_id
  ) then
    v_speaker := v_row.advisor_id;
  end if;
  insert into you.advisor_messages (user_id, chat_id, role, kind, speaker_id, text)
  values (v_row.user_id, v_row.advisor_chat_id, 'advisor', 'reply', v_speaker, left(btrim(p_text), 20000))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function you.tell_bot_page(p_handoff uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row core.dash_handoffs;
  v_why text;
  v_id uuid;
begin
  select * into v_row from core.dash_handoffs
  where id = p_handoff and kind = 'page' and status = 'failed' and told_at is null
  for update;
  if not found then
    return null;
  end if;
  v_why := regexp_replace(btrim(coalesce(v_row.error, '')), '\s+', ' ', 'g');
  if v_why <> '' and right(v_why, 1) not in ('.', '!', '?') then
    v_why := v_why || '.';
  end if;
  v_id := you.bot_page_say(
    p_handoff,
    case when v_why = '' then 'That didn''t work, sorry. Ask me again and I''ll have another go.'
         else 'That didn''t work, sorry. ' || v_why || ' Ask me again and I''ll have another go.' end
  );
  update core.dash_handoffs set told_at = now() where id = p_handoff;
  return v_id;
end;
$$;

create or replace function you.watch_bot_pages()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row record;
  v_told integer := 0;
begin
  -- Still going after 20 minutes: say so, once.
  for v_row in
    select id from core.dash_handoffs
    where kind = 'page' and status in ('pending', 'fired') and nudged_at is null
      and created_at < now() - interval '20 minutes'
      and created_at >= now() - interval '90 minutes'
    order by created_at
    limit 50
  loop
    perform you.bot_page_say(v_row.id,
      'Still working on your page. It''s taking longer than usual, and I''ll post the link here as soon as it''s ready.');
    update core.dash_handoffs set nudged_at = now() where id = v_row.id;
    v_told := v_told + 1;
  end loop;

  -- Still going after 90 minutes: the run stopped or never started.
  update core.dash_handoffs
  set status = 'failed',
      error = 'The session making it stopped before it finished, and nothing came back after 90 minutes.',
      finished_at = now()
  where kind = 'page' and status in ('pending', 'fired') and created_at < now() - interval '90 minutes';

  -- Every failed page the thread has not heard about, however it failed.
  for v_row in
    select id from core.dash_handoffs
    where kind = 'page' and status = 'failed' and told_at is null
    order by created_at
    limit 50
  loop
    perform you.tell_bot_page(v_row.id);
    v_told := v_told + 1;
  end loop;
  return v_told;
end;
$$;

revoke all on function you.bot_page_say(uuid, text) from public, anon;
revoke all on function you.tell_bot_page(uuid) from public, anon;
revoke all on function you.watch_bot_pages() from public, anon, authenticated;
grant execute on function you.bot_page_say(uuid, text) to authenticated, service_role;
grant execute on function you.tell_bot_page(uuid) to authenticated, service_role;
grant execute on function you.watch_bot_pages() to service_role;

comment on function you.tell_bot_page(uuid) is
  'Tells the thread a bot page failed, with the reason, once (plan #2997).';
comment on function you.watch_bot_pages() is
  'Every two minutes: nudges bot pages still going after 20 minutes, fails them after 90, and tells the thread of every failure (plan #2997).';

-- The schedule. Guarded so the local test database, which has no pg_cron,
-- still resets; unschedule-then-schedule so applying twice leaves one job.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available here -- skipping the bot pages watch. Expected on the local test database.';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'bot-pages-watch'
  $unschedule$;
  execute $schedule$
    select cron.schedule('bot-pages-watch', '*/2 * * * *', 'select you.watch_bot_pages()')
  $schedule$;
end;
$$;

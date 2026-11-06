-- The thread hears how a session hand-off ended (plan #3005.4, under #3005).
--
-- A bot that hands work to a Claude Code session (core.dash_handoffs, kind
-- 'session', core migration bot_handoffs) has said it is on it. The page
-- watch from plan #2997 (you migration 0047) is widened to these rows rather
-- than a second watch being added, so one cron job keeps both kinds honest:
--
--   you.bot_page_say(handoff, text, receipts)
--                    posts one message into the hand-off's thread. A People
--                    chat gets it as the bot (with the bot as speaker in a
--                    group) and the receipts as its links; an Ask Dash
--                    conversation gets it as Dash's turn. Takes a receipts
--                    argument now, so the old two-argument form is dropped:
--                    with both, a two-argument call would be ambiguous.
--   you.tell_bot_session(handoff, user, text, receipts)
--                    a finished session's result in a People chat: what it
--                    did, its links and its Undo, posted once, setting
--                    told_at. scripts/handoff-session.ts close calls it.
--   you.tell_bot_page(handoff)
--                    a failed page or session: says so with the reason,
--                    once. An Ask Dash row whose session wrote its own reply
--                    turn is only marked told.
--   you.watch_bot_pages()
--                    every two minutes, as before for pages; for sessions,
--                    silence is measured from the last report (last_seen_at,
--                    or fired_at if it never reported): quiet for 20 minutes
--                    is flagged in the thread once, quiet for 90 is failed
--                    and the thread told, and one closed done with nothing
--                    posted is reported after 10 minutes, pointing at Home
--                    where its changes have their Undo.
--
-- Each message is written to the row's own account, from the row's own
-- user_id. Schema only: no existing row is changed.

set search_path = you, public, extensions;

drop function if exists you.bot_page_say(uuid, text);

create or replace function you.bot_page_say(p_handoff uuid, p_text text, p_receipts jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row core.dash_handoffs;
  v_kind text;
  v_speaker uuid;
  v_receipts jsonb := coalesce(p_receipts, '[]'::jsonb);
  v_id uuid;
begin
  select * into v_row from core.dash_handoffs where id = p_handoff and kind in ('page', 'session');
  if not found then
    return null;
  end if;
  if jsonb_typeof(v_receipts) <> 'array' then
    v_receipts := '[]'::jsonb;
  end if;

  -- An Ask Dash conversation: Dash's own turn.
  if v_row.kind = 'session' and v_row.conversation_id is not null then
    if not exists (
      select 1 from core.conversations c where c.id = v_row.conversation_id and c.user_id = v_row.user_id
    ) then
      return null;
    end if;
    insert into core.conversation_turns (conversation_id, user_id, role, body)
    values (v_row.conversation_id, v_row.user_id, 'assistant', left(btrim(p_text), 8000))
    returning id into v_id;
    return v_id;
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
  insert into you.advisor_messages (user_id, chat_id, role, kind, speaker_id, text, receipts)
  values (v_row.user_id, v_row.advisor_chat_id, 'advisor', 'reply', v_speaker, left(btrim(p_text), 20000), v_receipts)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function you.tell_bot_session(p_handoff uuid, p_user_id uuid, p_text text, p_receipts jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_text is null or btrim(p_text) = '' then
    raise exception 'say what was done, in the bot''s voice' using errcode = 'invalid_parameter_value';
  end if;
  perform 1 from core.dash_handoffs
  where id = p_handoff and user_id = p_user_id and kind = 'session' and advisor_chat_id is not null
    and status = 'done' and told_at is null
  for update;
  if not found then
    return null;
  end if;
  v_id := you.bot_page_say(p_handoff, p_text, p_receipts);
  update core.dash_handoffs set told_at = now() where id = p_handoff and user_id = p_user_id;
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
  where id = p_handoff and kind in ('page', 'session') and status = 'failed' and told_at is null
  for update;
  if not found then
    return null;
  end if;
  -- An Ask Dash session that wrote its own reply turn has told the thread.
  if v_row.reply_turn_id is null then
    v_why := regexp_replace(btrim(coalesce(v_row.error, '')), '\s+', ' ', 'g');
    if v_why <> '' and right(v_why, 1) not in ('.', '!', '?') then
      v_why := v_why || '.';
    end if;
    v_id := you.bot_page_say(
      p_handoff,
      case when v_why = '' then 'That didn''t work, sorry. Ask me again and I''ll have another go.'
           else 'That didn''t work, sorry. ' || v_why || ' Ask me again and I''ll have another go.' end
    );
  end if;
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
  -- A page still going after 20 minutes: say so, once.
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

  -- A page still going after 90 minutes: the run stopped or never started.
  update core.dash_handoffs
  set status = 'failed',
      error = 'The session making it stopped before it finished, and nothing came back after 90 minutes.',
      finished_at = now()
  where kind = 'page' and status in ('pending', 'fired') and created_at < now() - interval '90 minutes';

  -- A session quiet for 20 minutes: flag it in the thread, once.
  for v_row in
    select id from core.dash_handoffs
    where kind = 'session' and status in ('pending', 'fired') and nudged_at is null
      and coalesce(last_seen_at, fired_at, created_at) < now() - interval '20 minutes'
      and coalesce(last_seen_at, fired_at, created_at) >= now() - interval '90 minutes'
    order by created_at
    limit 50
  loop
    perform you.bot_page_say(v_row.id,
      'This is taking longer than it should: nothing has come back for 20 minutes. I''ll post here as soon as it''s done, or tell you if it stops.');
    update core.dash_handoffs set nudged_at = now() where id = v_row.id;
    v_told := v_told + 1;
  end loop;

  -- A session quiet for 90 minutes has stopped.
  update core.dash_handoffs
  set status = 'failed',
      error = 'Nothing came back for 90 minutes, so the work stopped before it finished.',
      finished_at = now()
  where kind = 'session' and status in ('pending', 'fired')
    and coalesce(last_seen_at, fired_at, created_at) < now() - interval '90 minutes';

  -- Every failed page or session the thread has not heard about, however it failed.
  for v_row in
    select id from core.dash_handoffs
    where kind in ('page', 'session') and status = 'failed' and told_at is null
    order by created_at
    limit 50
  loop
    perform you.tell_bot_page(v_row.id);
    v_told := v_told + 1;
  end loop;

  -- A session closed done with nothing posted: say it finished, and where its Undo is.
  for v_row in
    select id from core.dash_handoffs
    where kind = 'session' and status = 'done' and told_at is null and reply_turn_id is null
      and finished_at < now() - interval '10 minutes'
    order by created_at
    limit 50
  loop
    perform you.bot_page_say(v_row.id,
      'That''s finished, but no write-up of it came back. Anything it changed is on Home under what Dash did today, where each change has its Undo.',
      jsonb_build_array(jsonb_build_object('label', 'What Dash did today', 'link', '/home#dash-today')));
    update core.dash_handoffs set told_at = now() where id = v_row.id;
    v_told := v_told + 1;
  end loop;
  return v_told;
end;
$$;

revoke all on function you.bot_page_say(uuid, text, jsonb) from public, anon;
revoke all on function you.tell_bot_session(uuid, uuid, text, jsonb) from public, anon;
revoke all on function you.tell_bot_page(uuid) from public, anon;
revoke all on function you.watch_bot_pages() from public, anon, authenticated;
grant execute on function you.bot_page_say(uuid, text, jsonb) to authenticated, service_role;
grant execute on function you.tell_bot_session(uuid, uuid, text, jsonb) to authenticated, service_role;
grant execute on function you.tell_bot_page(uuid) to authenticated, service_role;
grant execute on function you.watch_bot_pages() to service_role;

comment on function you.bot_page_say(uuid, text, jsonb) is
  'Posts one message into a page or session hand-off''s thread: as the bot in a People chat, as Dash in an Ask conversation (plans #2997, #3005.4).';
comment on function you.tell_bot_session(uuid, uuid, text, jsonb) is
  'Posts a finished session''s result into its People chat, with its links and Undo, once (plan #3005.4).';
comment on function you.tell_bot_page(uuid) is
  'Tells the thread a bot page or session hand-off failed, with the reason, once (plans #2997, #3005.4).';
comment on function you.watch_bot_pages() is
  'Every two minutes: nudges pages going 20 minutes and sessions quiet 20, fails them at 90, tells the thread of every failure, and reports a session closed done with nothing posted (plans #2997, #3005.4).';

notify pgrst, 'reload schema';

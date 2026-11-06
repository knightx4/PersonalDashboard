-- A bot-to-bot hand-off that fails or goes unanswered is flagged (plan
-- #3003.4, under #3003).
--
-- A hand-off (core.bot_handoffs, 0309) can be left in `sent` when the
-- receiving bot's thread stays busy or its run never starts, and nothing
-- retries it; one that fails is closed with its error and nothing is said
-- in the thread the person asked in. This sweep catches both:
--
--   flagged_at   when the sending bot told the source thread that the
--                hand-off failed or went unanswered. Set once.
--   resent_at    when the person last sent it again from Dev home. The ten
--                minutes are counted from here when it is set.
--
--   core.flag_bot_handoff(id)
--                posts the sender's flag into the source thread, once: in an
--                Ask Dash conversation as Dash's turn, in a People chat as
--                the sending bot (its speaker in a group), naming the bot
--                that did not answer and pointing at Dev home where it can
--                be sent again.
--   core.watch_bot_handoffs()
--                every two minutes: drops a hand-off not done ten minutes
--                after it was sent (or resent), then flags every failed or
--                dropped one from the last day not flagged yet.
--   core.resend_bot_handoff(id)
--                Dev home's Resend: puts a failed or dropped hand-off the
--                receiver never picked up back to `sent`, on the same row and
--                so the same dedupe key. One already picked up is refused,
--                since the receiver may have acted before it stopped.
--
-- The bot hand-offs are the owner's alone, so the sweep reads and writes
-- only the rows of core.dev_owner_id(). Schema only: no existing row is
-- changed by this file.

set search_path = core, public, extensions;

alter table core.bot_handoffs
  add column if not exists flagged_at timestamptz,
  add column if not exists resent_at timestamptz;

comment on column core.bot_handoffs.flagged_at is
  'When the sending bot told the source thread this hand-off failed or went unanswered (plan #3003.4). Set once.';
comment on column core.bot_handoffs.resent_at is
  'When the person last sent it again from Dev home; the ten minutes before it is dropped count from here (plan #3003.4).';

-- The sweep's two reads: open hand-offs by age, and ended ones not flagged yet.
create index if not exists bot_handoffs_open_sent_idx on core.bot_handoffs (user_id, sent_at)
  where status in ('sent', 'picked_up');
create index if not exists bot_handoffs_unflagged_idx on core.bot_handoffs (user_id, done_at)
  where status in ('failed', 'dropped') and flagged_at is null;
-- Dev home's list of flagged hand-offs, newest first.
create index if not exists bot_handoffs_flagged_idx on core.bot_handoffs (user_id, done_at desc)
  where status in ('failed', 'dropped') and flagged_at is not null;

-- How a bot is named in a line: its first name, "the Builder" kept whole.
create or replace function core.bot_handoff_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name is null or btrim(p_name) = '' then null
    when lower(split_part(btrim(p_name), ' ', 1)) = 'the' then btrim(p_name)
    when lower(split_part(btrim(p_name), ' ', 1)) in ('dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.', 'prof', 'prof.', 'sir')
      and split_part(btrim(p_name), ' ', 2) <> '' then split_part(regexp_replace(btrim(p_name), '\s+', ' ', 'g'), ' ', 2)
    else split_part(regexp_replace(btrim(p_name), '\s+', ' ', 'g'), ' ', 1)
  end;
$$;

create or replace function core.flag_bot_handoff(p_handoff uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row core.bot_handoffs;
  v_to text;
  v_quote text;
  v_why text;
  v_text text;
  v_resend boolean;
  v_kind text;
  v_speaker uuid;
  v_id uuid;
begin
  select * into v_row from core.bot_handoffs
  where id = p_handoff and status in ('failed', 'dropped') and flagged_at is null
  for update;
  if not found then
    return null;
  end if;

  if v_row.to_bot is null then
    v_to := 'Dash';
  else
    select core.bot_handoff_name(a.name) into v_to
    from you.board_advisors a where a.id = v_row.to_bot and a.user_id = v_row.user_id;
    v_to := coalesce(v_to, 'The bot I passed it to');
  end if;

  v_quote := regexp_replace(btrim(v_row.request), '\s+', ' ', 'g');
  if char_length(v_quote) > 140 then
    v_quote := rtrim(left(v_quote, 139)) || '…';
  end if;
  v_why := regexp_replace(btrim(coalesce(v_row.error, '')), '\s+', ' ', 'g');
  if v_why <> '' and right(v_why, 1) not in ('.', '!', '?') then
    v_why := v_why || '.';
  end if;
  -- Only one the receiver never started can be sent again (core.resend_bot_handoff).
  v_resend := v_row.picked_up_at is null and v_row.to_bot is not null;

  if v_row.status = 'dropped' and v_row.picked_up_at is null then
    v_text := v_to || ' hasn''t picked up what I passed on after 10 minutes: “' || v_quote || '”. Nothing has been done with it yet.';
  elsif v_row.status = 'dropped' then
    v_text := v_to || ' started on what I passed on but hadn''t finished after 10 minutes: “' || v_quote || '”. Look in '
      || v_to || '''s chat for anything already done before asking again.';
  else
    v_text := v_to || ' couldn''t take on what I passed on: “' || v_quote || '”.'
      || case when v_why = '' then '' else ' ' || v_why end;
  end if;
  if v_resend then
    v_text := v_text || ' You can send it again from Dev home.';
  end if;

  if v_row.source_kind = 'ask' then
    -- An Ask Dash conversation: Dash's own turn.
    if exists (
      select 1 from core.conversations c where c.id = v_row.source_id and c.user_id = v_row.user_id
    ) then
      insert into core.conversation_turns (conversation_id, user_id, role, body)
      values (v_row.source_id, v_row.user_id, 'assistant', v_text)
      returning id into v_id;
    end if;
  else
    select c.kind into v_kind from you.advisor_chats c where c.id = v_row.source_id and c.user_id = v_row.user_id;
    if v_kind is not null then
      if v_kind = 'group' and exists (
        select 1 from you.board_advisors a where a.id = v_row.from_bot and a.user_id = v_row.user_id
      ) then
        v_speaker := v_row.from_bot;
      end if;
      insert into you.advisor_messages (user_id, chat_id, role, kind, speaker_id, text, receipts)
      values (
        v_row.user_id, v_row.source_id, 'advisor', 'reply', v_speaker, v_text,
        case when v_resend
          then jsonb_build_array(jsonb_build_object('label', 'Send it again on Dev home', 'link', '/dev/raised#bot-handoffs'))
          else '[]'::jsonb end
      )
      returning id into v_id;
    end if;
  end if;

  -- Flagged even when the thread is gone: Dev home still lists it.
  update core.bot_handoffs set flagged_at = now() where id = p_handoff;
  return v_id;
end;
$$;

create or replace function core.watch_bot_handoffs()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := core.dev_owner_id();
  v_row record;
  v_told integer := 0;
begin
  if v_owner is null then
    return 0;
  end if;

  -- Not done ten minutes after it was sent: nobody is going to.
  update core.bot_handoffs
  set status = 'dropped',
      done_at = now(),
      error = case when picked_up_at is null
                   then 'Not picked up within 10 minutes.'
                   else 'Picked up but not finished within 10 minutes.' end
  where user_id = v_owner
    and status in ('sent', 'picked_up')
    and coalesce(resent_at, sent_at) < now() - interval '10 minutes';

  -- Every failure or drop of the last day the thread has not heard about.
  for v_row in
    select id from core.bot_handoffs
    where user_id = v_owner and status in ('failed', 'dropped') and flagged_at is null
      and done_at >= now() - interval '1 day'
    order by done_at
    limit 50
  loop
    perform core.flag_bot_handoff(v_row.id);
    v_told := v_told + 1;
  end loop;
  return v_told;
end;
$$;

create or replace function core.resend_bot_handoff(p_handoff uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  update core.bot_handoffs
  set status = 'sent', resent_at = now(), done_at = null, error = null, flagged_at = null
  where id = p_handoff
    and user_id = (select auth.uid())
    and status in ('failed', 'dropped')
    and picked_up_at is null
    and to_bot is not null
  returning id;
$$;

revoke all on function core.bot_handoff_name(text) from public, anon;
revoke all on function core.flag_bot_handoff(uuid) from public, anon, authenticated;
revoke all on function core.watch_bot_handoffs() from public, anon, authenticated;
revoke all on function core.resend_bot_handoff(uuid) from public, anon;
grant execute on function core.bot_handoff_name(text) to authenticated, service_role;
grant execute on function core.flag_bot_handoff(uuid) to service_role;
grant execute on function core.watch_bot_handoffs() to service_role;
grant execute on function core.resend_bot_handoff(uuid) to authenticated;

comment on function core.flag_bot_handoff(uuid) is
  'Tells the source thread, as the sending bot, that a bot-to-bot hand-off failed or went unanswered, once (plan #3003.4).';
comment on function core.watch_bot_handoffs() is
  'Every two minutes: drops the owner''s bot hand-offs not done 10 minutes after sending and flags each failure or drop in its source thread (plan #3003.4).';
comment on function core.resend_bot_handoff(uuid) is
  'Dev home''s Resend: a failed or dropped hand-off the receiver never picked up goes back to sent on the same row and dedupe key (plan #3003.4).';

-- The schedule. Guarded so the local test database, which has no pg_cron,
-- still applies this file.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available here -- skipping the bot hand-offs watch. Expected on the local test database.';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  execute $unschedule$
    select cron.unschedule(jobid) from cron.job where jobname = 'bot-handoffs-watch'
  $unschedule$;
  execute $schedule$
    select cron.schedule('bot-handoffs-watch', '*/2 * * * *', 'select core.watch_bot_handoffs()')
  $schedule$;
end;
$$;

notify pgrst, 'reload schema';

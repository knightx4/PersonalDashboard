-- The monthly counter that keeps spoken replies under $5 (plan #3006.3).
--
-- Chat replies are read aloud by Fish Audio's S2.1 Pro model, billed at $15
-- per million UTF-8 bytes of text. The person asked for it to stay under $5 a
-- month, so every reply's bytes are counted here before they are sent, and a
-- reply that would take the month past the cap is not sent at all.
--
-- core.speech_usage, one row per account per month:
--   month    the first day of the month, in the account's own timezone
--   bytes    UTF-8 bytes sent to Fish this month, which is what Fish bills
--   replies  how many replies were spoken
--
-- The person reads their own rows and cannot write them: the counter only
-- moves through the two functions below, so the cap cannot be reset from the
-- browser by writing the row back to zero.
--
--   core.reserve_speech_bytes(month, bytes, cap)
--     Adds the bytes to the month in one statement, and only when the total
--     stays within the cap, so two replies spoken at once cannot both pass a
--     check that only one of them fits. Returns the month's new total, or
--     null when the reply would go over (nothing is added then).
--   core.release_speech_bytes(month, bytes)
--     Takes a reservation back when Fish did not return audio, so a failed
--     call is not counted against the month.
--
-- Schema change only: no account's rows are written.

set search_path = core, public, extensions;

create table core.speech_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null,
  bytes integer not null default 0,
  replies integer not null default 0,
  updated_at timestamptz not null default now(),

  primary key (user_id, month),
  constraint speech_usage_month_ck check (extract(day from month) = 1),
  constraint speech_usage_bytes_ck check (bytes >= 0),
  constraint speech_usage_replies_ck check (replies >= 0)
);

alter table core.speech_usage enable row level security;

create policy speech_usage_read on core.speech_usage for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on core.speech_usage from anon;
revoke all on core.speech_usage from authenticated;
grant select on core.speech_usage to authenticated;
grant all on core.speech_usage to service_role;

comment on table core.speech_usage is
  'UTF-8 bytes of chat replies sent to Fish Audio to be spoken, per account per month, for the $5 monthly cap (plan #3006).';

create or replace function core.reserve_speech_bytes(p_month date, p_bytes integer, p_cap integer)
returns integer
language plpgsql
security definer
set search_path = core, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_total integer;
begin
  if v_user is null then
    raise exception 'reserve_speech_bytes needs a signed-in user';
  end if;
  if p_bytes is null or p_bytes <= 0 or p_cap is null or p_cap <= 0 then
    raise exception 'reserve_speech_bytes needs a positive byte count and cap';
  end if;
  if p_bytes > p_cap then
    return null;
  end if;

  insert into core.speech_usage as u (user_id, month, bytes, replies)
  values (v_user, date_trunc('month', p_month)::date, p_bytes, 1)
  on conflict (user_id, month) do update
    set bytes = u.bytes + excluded.bytes,
        replies = u.replies + 1,
        updated_at = now()
    where u.bytes + excluded.bytes <= p_cap
  returning u.bytes into v_total;

  return v_total;
end;
$$;

create or replace function core.release_speech_bytes(p_month date, p_bytes integer)
returns void
language plpgsql
security definer
set search_path = core, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or p_bytes is null or p_bytes <= 0 then
    return;
  end if;
  update core.speech_usage
     set bytes = greatest(bytes - p_bytes, 0),
         replies = greatest(replies - 1, 0),
         updated_at = now()
   where user_id = v_user
     and month = date_trunc('month', p_month)::date;
end;
$$;

revoke all on function core.reserve_speech_bytes(date, integer, integer) from public, anon;
revoke all on function core.release_speech_bytes(date, integer) from public, anon;
grant execute on function core.reserve_speech_bytes(date, integer, integer) to authenticated, service_role;
grant execute on function core.release_speech_bytes(date, integer) to authenticated, service_role;

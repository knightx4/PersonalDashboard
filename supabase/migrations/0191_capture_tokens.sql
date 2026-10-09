-- Personal capture tokens (plan #1705, feature #1659).
--
-- A Siri Shortcut, or any other tool the person sets up, adds things to the
-- app by presenting one of these instead of a browser sign-in. The person
-- makes a token on the account page; it is shown to them once and only its
-- SHA-256 is kept here, so a copy of this table cannot be turned back into a
-- working token. A token can only add things (the capture route, #1706), never
-- read, and it is revoked from the same page.
--
-- core.capture_tokens, one row per token:
--   label            what the person called it ("iPhone Shortcut").
--   token_hash       hex SHA-256 of the whole token (lib/capture/tokens.ts).
--   last_used_at     when a capture last went through with it.
--   revoked_at       set once, by core.revoke_capture_token; a revoked token
--                    is refused and never comes back.
--   minute_*, day_*  the rate limit's two fixed windows: when each started
--                    and how many captures it has let through. Kept on the
--                    row so the check and the count are one locked update,
--                    and two requests at once cannot both take the last slot.
--
-- The page reads and makes tokens on the person's own session. Nothing they
-- can call writes the counters or un-revokes a token: revoking goes through a
-- function, and checking a token goes through core.use_capture_token, which
-- only the service role may run, since the capture route has no session.

set search_path = core, public, extensions;

create table core.capture_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  label text not null,
  token_hash text not null,

  created_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz,
  revoked_at timestamptz,

  minute_started_at timestamptz,
  minute_count integer not null default 0,
  day_started_at timestamptz,
  day_count integer not null default 0,

  constraint capture_tokens_label_ck check (btrim(label) <> '' and char_length(label) <= 60),
  constraint capture_tokens_hash_ck check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint capture_tokens_counts_ck check (minute_count >= 0 and day_count >= 0)
);

-- The capture route finds a token by its hash, and two tokens never share one.
create unique index capture_tokens_hash_idx on core.capture_tokens (token_hash);
-- The account page's list, newest first.
create index capture_tokens_user_created_idx on core.capture_tokens (user_id, created_at desc);

alter table core.capture_tokens enable row level security;

create policy capture_tokens_select on core.capture_tokens for select to authenticated
  using (user_id = (select auth.uid()));
-- A new token starts unused, unrevoked and uncounted.
create policy capture_tokens_insert on core.capture_tokens for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and last_used_at is null and revoked_at is null
    and minute_started_at is null and minute_count = 0
    and day_started_at is null and day_count = 0
  );

revoke all on core.capture_tokens from anon, authenticated;
-- The hash is not readable from the page, and nothing but the label and the
-- hash is written from it.
grant select (id, user_id, label, created_at, last_used_at, revoked_at)
  on core.capture_tokens to authenticated;
grant insert (user_id, label, token_hash) on core.capture_tokens to authenticated;
grant all on core.capture_tokens to service_role;

-- Revoke one of the caller's own tokens. Revoking twice keeps the first time.
create or replace function core.revoke_capture_token(p_id uuid)
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  update core.capture_tokens
  set revoked_at = coalesce(revoked_at, clock_timestamp())
  where id = p_id and user_id = (select auth.uid())
  returning revoked_at;
$$;

revoke all on function core.revoke_capture_token(uuid) from public, anon;
grant execute on function core.revoke_capture_token(uuid) to authenticated;

-- Check a presented token and, when it may capture, count the capture.
--
-- outcome:
--   'unknown'  no token has this hash.
--   'revoked'  the token was revoked.
--   'limited'  a window is full; retry_at is when the fuller one reopens.
--              Nothing is counted.
--   'ok'       the capture may go ahead. Both windows have counted it and
--              last_used_at is now.
-- user_id and token_id are null unless the outcome is 'ok' or 'limited'.
create or replace function core.use_capture_token(
  p_hash text,
  p_per_minute integer,
  p_per_day integer,
  p_now timestamptz default clock_timestamp()
)
returns table (outcome text, user_id uuid, token_id uuid, retry_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  t core.capture_tokens%rowtype;
  m_start timestamptz;
  m_count integer;
  d_start timestamptz;
  d_count integer;
  reopen timestamptz;
begin
  select * into t from core.capture_tokens c where c.token_hash = p_hash for update;
  if not found then
    return query select 'unknown'::text, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;
  if t.revoked_at is not null then
    return query select 'revoked'::text, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  -- A window that has run its course starts again at this capture.
  if t.minute_started_at is null or p_now >= t.minute_started_at + interval '1 minute' then
    m_start := p_now; m_count := 0;
  else
    m_start := t.minute_started_at; m_count := t.minute_count;
  end if;
  if t.day_started_at is null or p_now >= t.day_started_at + interval '1 day' then
    d_start := p_now; d_count := 0;
  else
    d_start := t.day_started_at; d_count := t.day_count;
  end if;

  if m_count >= p_per_minute then
    reopen := m_start + interval '1 minute';
  end if;
  if d_count >= p_per_day then
    reopen := greatest(reopen, d_start + interval '1 day');
  end if;
  if reopen is not null then
    return query select 'limited'::text, t.user_id, t.id, reopen;
    return;
  end if;

  update core.capture_tokens c
  set minute_started_at = m_start, minute_count = m_count + 1,
      day_started_at = d_start, day_count = d_count + 1,
      last_used_at = p_now
  where c.id = t.id;

  return query select 'ok'::text, t.user_id, t.id, null::timestamptz;
end;
$$;

revoke all on function core.use_capture_token(text, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function core.use_capture_token(text, integer, integer, timestamptz) to service_role;

comment on table core.capture_tokens is
  'Personal tokens a Shortcut or other tool adds things to the app with; only the SHA-256 of each is kept (plan #1705).';
comment on column core.capture_tokens.token_hash is
  'Hex SHA-256 of the whole token. The token itself is shown once and never stored.';
comment on function core.use_capture_token(text, integer, integer, timestamptz) is
  'Checks a token by its hash and counts a capture against its rate limit: ok, unknown, revoked or limited (plan #1705).';

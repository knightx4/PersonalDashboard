-- Ask tokens: a personal token that asks Dash a question from a Siri
-- Shortcut, beside the capture tokens that only add things (0191).
--
-- An ask token is a row in core.capture_tokens with kind 'ask'. It is made,
-- listed and revoked on the account page exactly as a capture token is, and
-- only its SHA-256 is kept. The two kinds are not interchangeable: the
-- capture address refuses an ask token and the ask address refuses a capture
-- token, so a token that can only add never gains the right to read.
--
-- core.use_dash_token is core.use_capture_token with the kind it is checked
-- for: a token of the other kind comes back as 'other_kind' and is not
-- counted. core.use_capture_token keeps its signature and now checks for
-- 'capture', so the capture address behaves as before for every token that
-- exists today.

set search_path = core, public, extensions;

alter table core.capture_tokens
  add column kind text not null default 'capture',
  add constraint capture_tokens_kind_ck check (kind in ('capture', 'ask'));

grant select (kind) on core.capture_tokens to authenticated;
grant insert (kind) on core.capture_tokens to authenticated;

-- outcome is one of use_capture_token's, plus 'other_kind' for a live token
-- of the other kind. Nothing is counted unless the outcome is 'ok'.
create or replace function core.use_dash_token(
  p_hash text,
  p_kind text,
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
  if t.kind <> p_kind then
    return query select 'other_kind'::text, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  -- A window that has run its course starts again at this use.
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

revoke all on function core.use_dash_token(text, text, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function core.use_dash_token(text, text, integer, integer, timestamptz) to service_role;

create or replace function core.use_capture_token(
  p_hash text,
  p_per_minute integer,
  p_per_day integer,
  p_now timestamptz default clock_timestamp()
)
returns table (outcome text, user_id uuid, token_id uuid, retry_at timestamptz)
language sql
set search_path = ''
as $$
  select * from core.use_dash_token(p_hash, 'capture', p_per_minute, p_per_day, p_now);
$$;

revoke all on function core.use_capture_token(text, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function core.use_capture_token(text, integer, integer, timestamptz) to service_role;

comment on column core.capture_tokens.kind is
  'capture: the token can only add things (/api/capture). ask: the token asks Dash questions and reads the answer (/api/ask/voice).';
comment on function core.use_dash_token(text, text, integer, integer, timestamptz) is
  'Checks a token of one kind by its hash and counts a use against its rate limit: ok, unknown, revoked, other_kind or limited.';

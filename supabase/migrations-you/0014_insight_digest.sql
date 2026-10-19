-- Insights written in one model call from a stored digest (plan #2413.9,
-- under #2413).
--
-- A set of insights used to be a long routine session that read the whole
-- vault. It is now one Opus call (lib/you/insights-write.ts) that reads what
-- the cheap passes prepared: the note extracts (you 0013), the nightly
-- signals and tripwires (you 0012), every earlier insight with its verdict,
-- a handful of key private notes in full, and the digest the last call wrote.
--
-- 1. you.insight_digest
--
-- One row per person: the account of them the model wrote at the end of its
-- last call, for the next call to start from. It is replaced by each call
-- that finishes. run_id is the run that wrote it.
--
-- 2. you.insight_notes and you.insight_journal
--
-- The private notes the call reads whole (About me, Notes to Self, and the
-- notes a fired tripwire named), and the newest dated journal entries and
-- daily notes, cut to what one call can carry. Only notes tagged private
-- whose tag is current and that hold no credentials are returned, the same
-- rule as you.note_extracts_due: secret, clipped, audience and reference
-- notes never reach the model.
--
-- 3. you.save_insight_run
--
-- Saves what one call wrote, all together or not at all: each insight, its
-- tripwire, the earlier card it replaces, the digest, and the run marked
-- ready. A run that is no longer queued or running is refused, so a late
-- answer never lands on a run the stale check has failed.

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The digest.
-- ---------------------------------------------------------------------------

create table you.insight_digest (
  user_id uuid primary key references auth.users (id) on delete cascade,
  run_id uuid,
  body text not null check (btrim(body) <> '' and char_length(body) <= 20000),
  updated_at timestamptz not null default now(),
  foreign key (run_id, user_id)
    references you.insight_runs (id, user_id) on delete set null (run_id)
);

comment on table you.insight_digest is
  'The account of the person the insight call wrote last time, for the next call to start from (plan #2413.9).';

create index insight_digest_run_idx on you.insight_digest (run_id) where run_id is not null;

alter table you.insight_digest enable row level security;

create policy insight_digest_read on you.insight_digest for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on you.insight_digest from anon, authenticated;
grant select on you.insight_digest to authenticated;
grant select, insert, update, delete on you.insight_digest to service_role;

-- ---------------------------------------------------------------------------
-- 2. The notes the call reads whole.
-- ---------------------------------------------------------------------------

create or replace function you.insight_notes(p_user_id uuid, p_paths text[])
returns table (id uuid, path text, title text, body text, first_written_at timestamptz)
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select n.id, n.path, n.title, left(n.body, 30000), n.first_written_at
    from obsidian.notes n
   where n.user_id = p_user_id
     and n.deleted_at is null
     and n.voice = 'private'
     and not n.voice_due
     and n.path = any (p_paths)
     and not obsidian.note_holds_secret(n.path, n.title, n.body)
   order by n.path
$$;

comment on function you.insight_notes(uuid, text[]) is
  'The named notes, when private and holding no credentials, with up to 30,000 characters of body, for the insight call (plan #2413.9).';

create or replace function you.insight_journal(p_user_id uuid, p_limit int default 12)
returns table (path text, entry_date date, entry text)
language sql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
  with private_notes as (
    select n.path, n.body, n.dated_entries
      from obsidian.notes n
     where n.user_id = p_user_id
       and n.deleted_at is null
       and n.voice = 'private'
       and not n.voice_due
       and not obsidian.note_holds_secret(n.path, n.title, n.body)
  ),
  entries as (
    -- Offsets are in characters, as readDatedEntries in
    -- lib/vault/notes/first-written.ts counts them.
    select p.path,
           (e ->> 'date')::date as entry_date,
           substring(p.body from (e ->> 'offset')::int + 1
                     for (e ->> 'end')::int - (e ->> 'offset')::int) as entry
      from private_notes p,
           jsonb_array_elements(case when jsonb_typeof(p.dated_entries) = 'array'
                                     then p.dated_entries else '[]'::jsonb end) e
     where e ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$'
       and e ->> 'offset' ~ '^\d+$'
       and e ->> 'end' ~ '^\d+$'
    union all
    -- A daily note, whose file name is its date, is one entry.
    select p.path, substring(p.path from '(\d{4}-\d{2}-\d{2})\.md$')::date, p.body
      from private_notes p
     where p.path ~ '(^|/)\d{4}-\d{2}-\d{2}\.md$'
       and (p.dated_entries is null or jsonb_typeof(p.dated_entries) <> 'array'
            or jsonb_array_length(p.dated_entries) = 0)
  )
  select path, entry_date, left(btrim(entry), 4000)
    from entries
   where btrim(coalesce(entry, '')) <> ''
   order by entry_date desc, path
   limit greatest(p_limit, 0)
$$;

comment on function you.insight_journal(uuid, int) is
  'The newest dated entries and daily notes from private notes holding no credentials, each cut to 4,000 characters, for the insight call (plan #2413.9).';

-- ---------------------------------------------------------------------------
-- 3. Saving one call's insights.
-- ---------------------------------------------------------------------------

create or replace function you.save_insight_run(
  p_user_id uuid,
  p_run_id uuid,
  p_insights jsonb,
  p_digest text,
  p_summary text
)
returns uuid[]
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_status text;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_old uuid;
  item jsonb;
begin
  if p_user_id is null or p_run_id is null then
    raise exception 'save_insight_run needs a user and a run';
  end if;
  if coalesce(jsonb_typeof(p_insights), '') <> 'array' or jsonb_array_length(p_insights) = 0 then
    raise exception 'save_insight_run needs at least one insight';
  end if;

  select r.status into v_status
    from you.insight_runs r
   where r.id = p_run_id and r.user_id = p_user_id
   for update;
  if v_status is null then
    raise exception 'no insight run % for this person', p_run_id;
  end if;
  if v_status not in ('queued', 'running') then
    raise exception 'insight run % is already %', p_run_id, v_status;
  end if;

  for item in select value from jsonb_array_elements(p_insights) loop
    insert into you.insights (user_id, run_id, kind, claim, layers, receipts, confidence, live_ref)
    values (
      p_user_id, p_run_id,
      item ->> 'kind',
      item ->> 'claim',
      coalesce(item -> 'layers', '[]'::jsonb),
      coalesce(item -> 'receipts', '[]'::jsonb),
      item ->> 'confidence',
      nullif(btrim(coalesce(item ->> 'live_ref', '')), '')
    )
    returning id into v_id;
    v_ids := v_ids || v_id;

    if jsonb_typeof(item -> 'tripwire') = 'object' then
      insert into you.insight_tripwires (user_id, insight_id, kind, params)
      values (p_user_id, v_id, item -> 'tripwire' ->> 'kind',
              coalesce(item -> 'tripwire' -> 'params', '{}'::jsonb));
    end if;

    if coalesce(item ->> 'supersedes', '') ~ '^[0-9a-f-]{36}$' then
      v_old := (item ->> 'supersedes')::uuid;
      update you.insights
         set status = 'superseded', superseded_by = v_id
       where id = v_old and user_id = p_user_id and id <> v_id and status <> 'superseded';
    end if;
  end loop;

  if p_digest is not null and btrim(p_digest) <> '' then
    insert into you.insight_digest (user_id, run_id, body, updated_at)
    values (p_user_id, p_run_id, left(p_digest, 20000), now())
    on conflict (user_id) do update
      set run_id = excluded.run_id, body = excluded.body, updated_at = excluded.updated_at;
  end if;

  update you.insight_runs
     set status = 'ready', finished_at = now(), error = null,
         summary = left(nullif(btrim(coalesce(p_summary, '')), ''), 4000)
   where id = p_run_id and user_id = p_user_id;

  return v_ids;
end
$$;

comment on function you.save_insight_run(uuid, uuid, jsonb, text, text) is
  'Saves one insight call''s cards, tripwires, replacements and digest and marks the run ready, all together (plan #2413.9).';

revoke all on function you.insight_notes(uuid, text[]) from public, anon, authenticated;
revoke all on function you.insight_journal(uuid, int) from public, anon, authenticated;
revoke all on function you.save_insight_run(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function you.insight_notes(uuid, text[]) to service_role;
grant execute on function you.insight_journal(uuid, int) to service_role;
grant execute on function you.save_insight_run(uuid, uuid, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';

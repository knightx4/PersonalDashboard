-- Accepting one note's proposed map, and ranking themes by strength.
--
-- Two functions over the tables 0002 created. Neither adds a table or a
-- column.
--
-- obsidian.accept_note_map writes what a person accepted from one note: its
-- themes, its positions with the quote each came from, the edges between
-- those positions, and the note's membership of each theme. It runs as one
-- statement, so a proposal is written whole or not at all, and it checks the
-- two things a proposal carried from the browser cannot be trusted to have
-- kept: the note is still the version that was read (its blob_sha), and every
-- quote still appears in the note body character for character. Either
-- failing refuses the whole write.
--
-- It is security invoker. For a signed-in person RLS decides which note is
-- visible, so a note id belonging to somebody else is "not in the vault". The
-- owner written onto every row is the note's owner, which is also what lets
-- the sweep call it with the service role.
--
-- Positions are matched, not reconciled. A proposed position whose statement
-- equals one the person already has, ignoring case, gets a new source on the
-- existing row rather than a second row. That makes accepting the same note
-- twice harmless. Anything looser is the merge pass's job (KNOWLEDGE-SPEC.md,
-- build order step 6).
--
-- obsidian.refresh_theme_strength recomputes strength, first_seen and
-- last_seen for the themes named. Strength is an interest measure
-- (KNOWLEDGE-SPEC.md, "Themes"). It is a sum over the theme's notes of:
--
--   text     1 + ln(1 + size_bytes / 1000). A note counts once, and more
--            text counts for more with diminishing returns.
--   recency  0.5 ^ (years since git_updated_at / 2). A two-year half-life.
--            An undated note counts 0.75; most notes are undated after a
--            first sync, and treating them as brand new or as ancient would
--            both be wrong.
--   stance   the mean over the note's grounded positions in this theme of
--            held 1, encountered 0.5, generated 0.25. A note with no
--            positions in the theme counts 0.5.
--
-- first_seen and last_seen are the earliest and latest dated note.

set search_path = obsidian, public, extensions;

create or replace function obsidian.refresh_theme_strength(p_theme_ids uuid[])
returns void
language sql
security invoker
set search_path = obsidian, pg_catalog
as $$
  with per_note as (
    select
      tn.theme_id,
      n.size_bytes,
      n.git_updated_at,
      (
        select avg(case s.stance when 'held' then 1.0 when 'encountered' then 0.5 else 0.25 end)
        from (
          select distinct p.id, p.stance
          from obsidian.theme_positions tp
          join obsidian.positions p on p.id = tp.position_id
          join obsidian.position_sources ps on ps.position_id = p.id and ps.note_id = n.id
          where tp.theme_id = tn.theme_id and p.ungrounded_at is null
        ) s
      ) as stance_weight
    from obsidian.theme_notes tn
    join obsidian.notes n on n.id = tn.note_id and n.deleted_at is null
    where tn.theme_id = any (p_theme_ids)
  ),
  scored as (
    select
      theme_id,
      sum(
        (1 + ln(1 + greatest(size_bytes, 0) / 1000.0))
        * case
            when git_updated_at is null then 0.75
            else power(
              0.5,
              greatest(extract(epoch from now() - git_updated_at), 0) / (2 * 365.25 * 86400)
            )
          end
        * coalesce(stance_weight, 0.5)
      ) as strength,
      min(git_updated_at) as first_seen,
      max(git_updated_at) as last_seen
    from per_note
    group by theme_id
  )
  update obsidian.themes t
  set strength = coalesce(round(s.strength::numeric, 4), 0),
      first_seen = s.first_seen,
      last_seen = s.last_seen
  from (
    select u.id, sc.strength, sc.first_seen, sc.last_seen
    from unnest(p_theme_ids) as u (id)
    left join scored sc on sc.theme_id = u.id
  ) s
  where t.id = s.id;
$$;

create or replace function obsidian.accept_note_map(
  p_note_id uuid,
  p_blob_sha text,
  p_map jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = obsidian, pg_catalog
as $$
declare
  v_note record;
  v_item jsonb;
  v_key text;
  v_id uuid;
  v_from uuid;
  v_to uuid;
  v_quote text;
  v_theme_ids jsonb := '{}'::jsonb;
  v_position_ids jsonb := '{}'::jsonb;
  v_touched uuid[] := '{}';
  v_rows int;
  n_themes int := 0;
  n_positions int := 0;
  n_new_positions int := 0;
  n_edges int := 0;
begin
  select id, user_id, body, blob_sha
  into v_note
  from obsidian.notes
  where id = p_note_id and deleted_at is null;

  if not found then
    raise exception 'That note is not in the vault any more.'
      using errcode = 'P0002';
  end if;

  if v_note.blob_sha is distinct from p_blob_sha then
    raise exception 'The note has changed since it was read.'
      using errcode = 'P0001', detail = 'stale-note';
  end if;

  -- Themes, matched on name ignoring case, the way the unique index is.
  for v_item in select value from jsonb_array_elements(coalesce(p_map -> 'themes', '[]'::jsonb)) loop
    insert into obsidian.themes (user_id, name, about)
    values (v_note.user_id, btrim(v_item ->> 'name'), btrim(v_item ->> 'about'))
    on conflict (user_id, lower(name)) do nothing;

    select id into v_id
    from obsidian.themes
    where user_id = v_note.user_id and lower(name) = lower(btrim(v_item ->> 'name'));

    insert into obsidian.theme_notes (user_id, theme_id, note_id, basis)
    values (v_note.user_id, v_id, v_note.id, btrim(v_item ->> 'basis'))
    on conflict (theme_id, note_id) do nothing;

    v_theme_ids := v_theme_ids || jsonb_build_object(v_item ->> 'key', v_id);
    v_touched := v_touched || v_id;
    n_themes := n_themes + 1;
  end loop;

  -- Positions, each with the quote that grounds it.
  for v_item in select value from jsonb_array_elements(coalesce(p_map -> 'positions', '[]'::jsonb)) loop
    v_quote := v_item ->> 'quote';
    if v_quote is null or v_quote = '' or strpos(v_note.body, v_quote) = 0 then
      raise exception 'A quote is not in the note: "%"', left(coalesce(v_quote, ''), 120)
        using errcode = 'P0001', detail = 'quote-missing';
    end if;

    select id into v_id
    from obsidian.positions
    where user_id = v_note.user_id
      and lower(statement) = lower(btrim(v_item ->> 'statement'))
    order by created_at
    limit 1;

    if v_id is null then
      insert into obsidian.positions (user_id, name, statement, basis, kind, stance)
      values (
        v_note.user_id,
        btrim(v_item ->> 'name'),
        btrim(v_item ->> 'statement'),
        btrim(v_item ->> 'basis'),
        (v_item ->> 'kind')::obsidian.position_kind,
        (v_item ->> 'stance')::obsidian.position_stance
      )
      returning id into v_id;
      n_new_positions := n_new_positions + 1;
    else
      update obsidian.positions set ungrounded_at = null
      where id = v_id and ungrounded_at is not null;
    end if;

    insert into obsidian.position_sources (user_id, position_id, note_id, quote, blob_sha)
    values (v_note.user_id, v_id, v_note.id, v_quote, v_note.blob_sha)
    on conflict (position_id, note_id, quote) do nothing;

    for v_key in select value from jsonb_array_elements_text(coalesce(v_item -> 'themes', '[]'::jsonb)) loop
      if not (v_theme_ids ? v_key) then
        raise exception 'A position names a theme the proposal does not have: %', v_key;
      end if;
      insert into obsidian.theme_positions (user_id, theme_id, position_id, basis)
      values (v_note.user_id, (v_theme_ids ->> v_key)::uuid, v_id, btrim(v_item ->> 'basis'))
      on conflict (theme_id, position_id) do nothing;
    end loop;

    v_position_ids := v_position_ids || jsonb_build_object(v_item ->> 'key', v_id);
    n_positions := n_positions + 1;
  end loop;

  -- Edges between the positions above. Two proposed positions can land on the
  -- same existing row, which would make an edge to itself; that one is dropped.
  for v_item in select value from jsonb_array_elements(coalesce(p_map -> 'edges', '[]'::jsonb)) loop
    if not (v_position_ids ? (v_item ->> 'from')) or not (v_position_ids ? (v_item ->> 'to')) then
      raise exception 'An edge names a position the proposal does not have.';
    end if;
    if v_item ->> 'type' = 'mentions' then
      raise exception 'mentions is closed to new writes.';
    end if;

    v_from := (v_position_ids ->> (v_item ->> 'from'))::uuid;
    v_to := (v_position_ids ->> (v_item ->> 'to'))::uuid;
    continue when v_from = v_to;

    insert into obsidian.position_edges (user_id, from_id, to_id, type, description)
    values (
      v_note.user_id,
      v_from,
      v_to,
      (v_item ->> 'type')::obsidian.edge_type,
      nullif(btrim(coalesce(v_item ->> 'description', '')), '')
    )
    on conflict (from_id, to_id, type) do nothing;
    get diagnostics v_rows = row_count;
    n_edges := n_edges + v_rows;
  end loop;

  perform obsidian.refresh_theme_strength(v_touched);

  return jsonb_build_object(
    'themes', n_themes,
    'positions', n_positions,
    'newPositions', n_new_positions,
    'edges', n_edges
  );
end;
$$;

revoke all on function obsidian.refresh_theme_strength(uuid[]) from public, anon;
revoke all on function obsidian.accept_note_map(uuid, text, jsonb) from public, anon;
grant execute on function obsidian.refresh_theme_strength(uuid[]) to authenticated, service_role;
grant execute on function obsidian.accept_note_map(uuid, text, jsonb) to authenticated, service_role;

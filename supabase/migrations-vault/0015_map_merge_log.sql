-- The merge log on the Map page (plan #821).
--
-- Every `same` proposal is merged without review (#814 answered C), so the
-- Map page lists the merges instead, with an undo on each. There are about
-- 1,800 of them, and a theme merge's record carries every row it moved: 90 kB
-- on average, most of it theme_positions. Reading a page of records through
-- PostgREST would ship all of that to show two names and a few notes, so this
-- function shapes one page in the database and returns only what a row shows.
--
-- For each merge: both names as they were, the survivor's name now, the
-- model's reason from the proposal, and per side up to three notes (a theme)
-- or three quotes (a position) with the full count.
--
--   absorbed side   the notes or quotes the merge moved onto the survivor,
--                   plus the ones deleted because the survivor already had
--                   them. Read from the record, so it is the same whether the
--                   merge stands or was undone.
--   survivor side   the survivor's rows today, leaving out the ones the merge
--                   moved onto it. Empty when the survivor has since been
--                   merged away, which is also when undo refuses.
--
-- Theme merges come first, because they change what Learn offers; newest
-- first within each kind. Security invoker: the owner's RLS on map_merges and
-- the map tables decides what a caller sees.

set search_path = obsidian, public, extensions;

-- The log's order, so a page is read from the index rather than by sorting
-- every record, whose rows are wide.
create index if not exists map_merges_log_idx
  on obsidian.map_merges (user_id, (kind = 'theme') desc, merged_at desc, id);

create or replace function obsidian.map_merge_log(p_limit int default 25, p_offset int default 0)
returns table (
  id uuid,
  kind text,
  merged_at timestamptz,
  undone_at timestamptz,
  survivor_id uuid,
  absorbed_id uuid,
  absorbed_name text,
  survivor_name_before text,
  -- Null when the survivor is no longer in the map.
  survivor_name text,
  reason text,
  absorbed_items jsonb,
  absorbed_count int,
  survivor_items jsonb,
  survivor_count int
)
language sql
stable
security invoker
set search_path = obsidian, pg_catalog
as $$
  -- The page's ids first, so the records' jsonb is read for these rows only
  -- and not for every merge the sort passes over.
  with ids as materialized (
    select m.id
      from obsidian.map_merges m
     order by (m.kind = 'theme') desc, m.merged_at desc, m.id
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  ),
  page as (
    select m.id, m.kind, m.merged_at, m.undone_at, m.survivor_id, m.absorbed_id,
           m.absorbed ->> 'name' as absorbed_name,
           m.survivor_before ->> 'name' as survivor_name_before,
           m.proposal_id,
           case m.kind
             when 'theme' then
               coalesce(m.moved -> 'theme_notes', '[]') || coalesce(m.removed -> 'theme_notes', '[]')
             else
               coalesce(m.moved -> 'position_sources', '[]') || coalesce(m.removed -> 'position_sources', '[]')
           end as absorbed_rows,
           case m.kind
             when 'theme' then coalesce(m.moved -> 'theme_notes', '[]')
             else coalesce(m.moved -> 'position_sources', '[]')
           end as moved_rows
      from ids
      join obsidian.map_merges m on m.id = ids.id
  )
  select p.id, p.kind, p.merged_at, p.undone_at, p.survivor_id, p.absorbed_id,
         p.absorbed_name, p.survivor_name_before,
         coalesce(t.name, pos.name) as survivor_name,
         mp.reason,
         a.items, jsonb_array_length(p.absorbed_rows),
         s.items, coalesce(s.total, 0)
    from page p
    left join obsidian.map_merge_proposals mp on mp.id = p.proposal_id
    left join obsidian.themes t on p.kind = 'theme' and t.id = p.survivor_id
    left join obsidian.positions pos on p.kind = 'position' and pos.id = p.survivor_id
    -- The absorbed side, from the record.
    cross join lateral (
      select coalesce(jsonb_agg(x.item order by x.ord), '[]') as items
        from (
          select r.ord,
                 jsonb_build_object(
                   'quote', r.row ->> 'quote',
                   'title', n.title,
                   'path', case when n.deleted_at is null then n.path end
                 ) as item
            from jsonb_array_elements(p.absorbed_rows) with ordinality as r (row, ord)
            left join obsidian.notes n on n.id = (r.row ->> 'note_id')::uuid
           order by r.ord
           limit 3
        ) x
    ) a
    -- The survivor side, as it stands, less what the merge moved onto it.
    cross join lateral (
      select coalesce(jsonb_agg(y.item order by y.title), '[]') as items, max(y.total)::int as total
        from (
          select jsonb_build_object(
                   'quote', src.quote,
                   'title', n.title,
                   'path', case when n.deleted_at is null then n.path end
                 ) as item,
                 n.title,
                 count(*) over () as total
            from (
              select tn.id, tn.note_id, null::text as quote
                from obsidian.theme_notes tn
               where p.kind = 'theme' and tn.theme_id = p.survivor_id
              union all
              select ps.id, ps.note_id, ps.quote
                from obsidian.position_sources ps
               where p.kind = 'position' and ps.position_id = p.survivor_id
            ) src
            join obsidian.notes n on n.id = src.note_id
           where src.id not in (
             select (mr ->> 'id')::uuid from jsonb_array_elements(p.moved_rows) mr
           )
           order by n.title
           limit 3
        ) y
    ) s
   order by (p.kind = 'theme') desc, p.merged_at desc, p.id
$$;

-- How many merges each kind has, for the page's heading and its paging.
create or replace function obsidian.map_merge_log_counts()
returns table (kind text, merges int, undone int)
language sql
stable
security invoker
set search_path = obsidian, pg_catalog
as $$
  select m.kind, count(*)::int, count(m.undone_at)::int
    from obsidian.map_merges m
   group by m.kind
$$;

revoke all on function obsidian.map_merge_log(int, int) from public, anon;
revoke all on function obsidian.map_merge_log_counts() from public, anon;
grant execute on function obsidian.map_merge_log(int, int) to authenticated, service_role;
grant execute on function obsidian.map_merge_log_counts() to authenticated, service_role;

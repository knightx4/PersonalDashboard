-- The ranked list of your ideas on the Map (plan #2947.5).
--
-- The combined score is computed here and nowhere else: the square root of
-- usefulness times novelty, rounded half away from zero and held between 1 and
-- 100, so an idea Jev scored 0 on either still lists at 1. It is null where
-- the two scores are (a requirement, someone else's idea, a description), and
-- the case says so explicitly because greatest() would otherwise turn a null
-- into 1. The sort runs on it, so the number the page shows is the one it
-- sorted on.
--
-- obsidian.idea_list reads one page of the list for the signed-in person, and
-- obsidian.idea_list_counts the line under it. Both join the score rows to the
-- live positions of kind 'position' that are held or generated, because a
-- score row can outlive the idea it was written for (#2947.3). Both are
-- security invoker, scoped to auth.uid() on top of row-level security. No
-- account's rows are read or changed by this migration.

set search_path = obsidian, public, extensions;

alter table obsidian.position_scores
  add column combined smallint generated always as (
    case
      when usefulness is null or novelty is null then null
      else greatest(1, round(sqrt(usefulness::numeric * novelty::numeric)))::smallint
    end
  ) stored;

comment on column obsidian.position_scores.combined is
  'round(sqrt(usefulness x novelty)), at least 1; null where either is null. The Map''s Ideas view sorts on it (plan #2947.5).';

create index position_scores_user_combined_idx
  on obsidian.position_scores (user_id, combined desc);

create function obsidian.idea_list(
  p_sort text default 'combined',
  p_offset int default 0,
  p_limit int default 50
)
returns table (
  position_id uuid,
  statement text,
  usefulness smallint,
  novelty smallint,
  combined smallint,
  theme_id uuid,
  theme_name text,
  quote text,
  note_path text,
  note_title text,
  total bigint
)
language sql
stable
security invoker
set search_path = obsidian, extensions, pg_temp
as $$
  with listed as (
    select p.id, p.statement, p.created_at, s.usefulness, s.novelty, s.combined
      from obsidian.position_scores s
      join obsidian.positions p on p.id = s.position_id and p.user_id = s.user_id
     where s.user_id = (select auth.uid())
       and s.idea_type in ('own_idea', 'project_design')
       and s.combined is not null
       and p.kind = 'position'
       and p.stance in ('held', 'generated')
  ),
  ranked as (
    -- The chosen score first, then the other two, then the newest idea.
    select l.*,
           count(*) over () as total,
           row_number() over (
             order by
               case p_sort when 'usefulness' then l.usefulness
                           when 'novelty' then l.novelty
                           else l.combined end desc,
               case p_sort when 'combined' then l.usefulness
                           else l.combined end desc,
               case p_sort when 'novelty' then l.usefulness
                           else l.novelty end desc,
               l.created_at desc,
               l.id
           ) as rank
      from listed l
  ),
  page as (
    select * from ranked
     where rank > greatest(p_offset, 0)
     order by rank
     limit greatest(p_limit, 0)
  )
  select pg.id, pg.statement, pg.usefulness, pg.novelty, pg.combined,
         th.id, th.name, src.quote, src.path, src.title, pg.total
    from page pg
    -- The strongest theme it sits under.
    left join lateral (
      select t.id, t.name
        from obsidian.theme_positions tp
        join obsidian.themes t on t.id = tp.theme_id and t.user_id = tp.user_id
       where tp.position_id = pg.id
       order by t.strength desc, t.name
       limit 1
    ) th on true
    -- One sentence it came from, in a note still in the vault, as the theme
    -- page orders them: by the note's title.
    left join lateral (
      select ps.quote, n.path, n.title
        from obsidian.position_sources ps
        join obsidian.notes n on n.id = ps.note_id and n.user_id = ps.user_id
       where ps.position_id = pg.id
         and n.deleted_at is null
       order by n.title, ps.quote
       limit 1
    ) src on true
   order by pg.rank
$$;

comment on function obsidian.idea_list(text, int, int) is
  'One page of the signed-in person''s scored own ideas and designs, sorted by combined, usefulness or novelty (plan #2947.5).';

create function obsidian.idea_list_counts()
returns table (
  listed int,
  requirements int,
  others_ideas int,
  descriptions int,
  unscored int
)
language sql
stable
security invoker
set search_path = obsidian, extensions, pg_temp
as $$
  with ideas as (
    select p.id
      from obsidian.positions p
     where p.user_id = (select auth.uid())
       and p.kind = 'position'
       and p.stance in ('held', 'generated')
  ),
  typed as (
    select s.idea_type
      from ideas i
      join obsidian.position_scores s on s.position_id = i.id
  ),
  waiting as (
    -- Ideas the scoring job will reach: at least one live source note that is
    -- not clipped, reference or secret (0045), and no score row yet.
    select i.id
      from ideas i
      join obsidian.position_voices v on v.position_id = i.id
     where v.notes - v.clipped_notes - v.reference_notes - v.secret_notes > 0
       and not exists (select 1 from obsidian.position_scores s where s.position_id = i.id)
  )
  select (select count(*) from typed where idea_type in ('own_idea', 'project_design'))::int,
         (select count(*) from typed where idea_type = 'requirement')::int,
         (select count(*) from typed where idea_type = 'others_idea')::int,
         (select count(*) from typed where idea_type = 'description')::int,
         (select count(*) from waiting)::int
$$;

comment on function obsidian.idea_list_counts() is
  'How many of the signed-in person''s ideas the Ideas view lists, leaves out by type, and has not scored yet (plan #2947.5).';

revoke all on function obsidian.idea_list(text, int, int) from public, anon;
revoke all on function obsidian.idea_list_counts() from public, anon;
grant execute on function obsidian.idea_list(text, int, int) to authenticated, service_role;
grant execute on function obsidian.idea_list_counts() to authenticated, service_role;

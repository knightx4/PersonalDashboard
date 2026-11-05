-- Score positions only (plan #2947.3).
--
-- 0045's obsidian.idea_score_due listed every held or generated row of
-- obsidian.positions, claims, distinctions and frames among them: 2,716 for
-- the owner. Feature #2947 scores ideas of kind position only, about 833, so
-- the function now filters on kind as well. Nothing else changes, and no
-- account's rows are read or changed. A claim already scored keeps its row;
-- none had been scored when this was written.

set search_path = obsidian, public, extensions;

create or replace function obsidian.idea_score_due(
  p_user_id uuid,
  p_rubric_version text,
  p_limit int default 50
)
returns table (
  position_id uuid,
  source_sig text,
  scored boolean
)
language sql
stable
security invoker
set search_path = obsidian, extensions, pg_temp
as $$
  with eligible as (
    select p.id, p.statement, p.basis
      from obsidian.positions p
      join obsidian.position_voices v on v.position_id = p.id and v.user_id = p_user_id
     where p.user_id = p_user_id
       and p.kind = 'position'
       and p.stance in ('held', 'generated')
       and v.notes - v.clipped_notes - v.reference_notes - v.secret_notes > 0
  ),
  signed as (
    select e.id,
           md5(
             e.statement || chr(1) || coalesce(e.basis, '') || chr(1) ||
             coalesce(string_agg(
               ps.note_id::text || chr(2) || ps.quote || chr(2) || n.path || chr(2) ||
                 n.title || chr(2) || coalesce(n.voice::text, '') || chr(2) || n.blob_sha,
               chr(3) order by ps.note_id, ps.quote
             ), '')
           ) as sig
      from eligible e
      join obsidian.position_sources ps on ps.position_id = e.id and ps.user_id = p_user_id
      join obsidian.notes n on n.id = ps.note_id and n.user_id = p_user_id and n.deleted_at is null
     group by e.id, e.statement, e.basis
  )
  select s.id, s.sig, sc.id is not null
    from signed s
    left join obsidian.position_scores sc on sc.position_id = s.id and sc.user_id = p_user_id
   where sc.id is null
      or sc.rubric_version <> p_rubric_version
      or sc.source_sig is distinct from s.sig
   order by sc.id is not null, s.id
   limit greatest(p_limit, 0)
$$;

comment on function obsidian.idea_score_due(uuid, text, int) is
  'Up to p_limit of a person''s map positions (kind position) with no score, an older rubric''s, or sources changed since the last check, unscored first (plan #2947.3).';


-- The vault notes nearest each idea, for the evidence links (plan #2006.3).
--
-- An idea you have already written about in your vault is backed by that
-- note. The daily run asks this function for each batch of ideas' nearest
-- notes, works out how much each counts from the note's folder
-- (lib/learn/evidence/notes.ts), and writes the links to
-- learn.evidence_links (migration learn 0121). The weighing stays in the app,
-- where a test can reach it; the comparing stays here, next to the vectors.
--
-- For each idea in p_concept_ids, its p_per_idea nearest notes at
-- p_min_similarity or above, closest first. The same notes are left out as in
-- obsidian.nearest_notes (vault 0024): soft-deleted notes, templates,
-- CLAUDE.md or AGENTS.md, and stubs under 20 characters of prose. A note is
-- compared only with an idea embedded by the same model. The scan is exact (the
-- `+ 0` keeps it off the vector index, which would drop matches once the
-- filters apply): a batch of fifty ideas against a vault of 1,300 notes is
-- 65,000 distances, well under a second.
--
-- Reads only; the run holds the service role, so nobody else may call it.

set search_path = learn, public, extensions;

create or replace function learn.vault_note_matches(
  p_user_id uuid,
  p_concept_ids uuid[],
  p_min_similarity real default 0.6,
  p_per_idea integer default 5
)
returns table (
  concept_id uuid,
  note_id uuid,
  path text,
  title text,
  similarity real,
  created_at timestamptz,
  written_at timestamptz
)
language sql
stable
security invoker
set search_path = learn, obsidian, public, extensions
as $$
  select c.id, near.note_id, near.path, near.title, near.similarity,
         near.created_at, near.written_at
    from learn.concepts c
   cross join lateral (
     select candidate.*
       from (
         select e.note_id, n.path, n.title, n.created_at, n.written_at,
                (1 - (e.embedding <=> c.embedding))::real as similarity,
                e.embedding <=> c.embedding as distance
           from obsidian.note_embeddings e
           join obsidian.notes n on n.id = e.note_id
          where e.user_id = p_user_id
            and n.deleted_at is null
            and e.embedding_model = c.embedding_model
            and n.path !~* '(^|/)templates/'
            and n.path !~* '(^|/)(claude|agents)\.md$'
          order by (e.embedding <=> c.embedding) + 0
          limit greatest(p_per_idea, 1) + 10
       ) candidate
       -- The body is read only for the candidates, not for the whole vault.
       join obsidian.notes body_of on body_of.id = candidate.note_id
      where obsidian.note_prose_chars(body_of.body) >= 20
        and candidate.similarity >= p_min_similarity
      order by candidate.distance, candidate.path
      limit greatest(p_per_idea, 1)
   ) near
   where c.user_id = p_user_id
     and c.id = any (p_concept_ids)
     and c.embedding is not null
   order by c.id, near.similarity desc
$$;

revoke all on function learn.vault_note_matches(uuid, uuid[], real, integer)
  from public, anon, authenticated;
grant execute on function learn.vault_note_matches(uuid, uuid[], real, integer)
  to service_role;

comment on function learn.vault_note_matches(uuid, uuid[], real, integer) is
  'Each listed idea''s nearest vault notes at or above a similarity, closest first, for the note evidence links (plan #2006.3).';

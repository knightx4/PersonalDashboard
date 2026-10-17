-- Merging two ideas into one (plan #2147.2): the function 0153 leaves out.
--
-- A file of its own because the Supabase connector asks the person to confirm
-- any statement that deletes, and a session working alone cannot answer that
-- prompt. 0153's table, listing and keep-both did not need to wait for it.

set search_path = learn, public, extensions;

-- ---------------------------------------------------------------------------
-- Merge: `p_retire` goes, `p_keep` stays with both subjects' answers.
--
-- Security definer, because a merge moves rows in tables the person has no
-- update policy on (probes, review questions). Every statement names the
-- caller's user_id, and both ideas are checked to be theirs first.
--
-- What moves to the kept idea: its answers (probes, review questions and
-- what came next), its state when that is better evidence than the kept
-- idea's own, goals, readings, notes, cards, catalogue links, evidence,
-- places and topics, and the retired idea's subjects as cross-listings. A
-- row the kept idea already has its own of (a place, a topic parent, a
-- catalogue link to the same segment) is left to go with the retired idea.
--
-- What cannot move: prerequisite links. `concept_edges` holds both ends in
-- one subject through a foreign key, and the kept idea's home is the other
-- subject, so the retired idea's links are copied into the review row and
-- removed with it.

create or replace function learn.merge_ideas(p_keep uuid, p_retire uuid, p_similarity double precision)
returns void
language plpgsql
security definer
set search_path = learn, public, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
  v_keep learn.concepts%rowtype;
  v_retire learn.concepts%rowtype;
  v_keep_state learn.concept_state%rowtype;
  v_retire_state learn.concept_state%rowtype;
  v_retired jsonb;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_keep = p_retire then
    raise exception 'An idea cannot be merged into itself' using errcode = '22023';
  end if;

  select * into v_keep from learn.concepts where id = p_keep and user_id = v_user for update;
  select * into v_retire from learn.concepts where id = p_retire and user_id = v_user for update;
  if v_keep.id is null or v_retire.id is null then
    raise exception 'Idea not found' using errcode = 'P0002';
  end if;

  select * into v_keep_state from learn.concept_state where concept_id = p_keep and user_id = v_user;
  select * into v_retire_state from learn.concept_state where concept_id = p_retire and user_id = v_user;

  v_retired := jsonb_build_object(
    'concept', to_jsonb(v_retire) - 'embedding',
    'state', case when v_retire_state.concept_id is null then null else to_jsonb(v_retire_state) end,
    'subjects', coalesce((
      select jsonb_agg(to_jsonb(cs)) from learn.concept_subjects cs
       where cs.user_id = v_user and cs.concept_id = p_retire), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(to_jsonb(e)) from learn.concept_edges e
       where e.user_id = v_user and (e.prerequisite_id = p_retire or e.dependent_id = p_retire)), '[]'::jsonb)
  );

  -- Its subjects become the kept idea's cross-listings.
  insert into learn.concept_subjects (user_id, concept_id, subject_id, basis)
  select v_user, p_keep, s.subject_id,
         'Merged with "' || v_retire.name || '", the same idea written in this subject.'
    from (
      select v_retire.subject_id as subject_id
      union
      select cs.subject_id from learn.concept_subjects cs
       where cs.user_id = v_user and cs.concept_id = p_retire
    ) s
   where s.subject_id <> v_keep.subject_id
  on conflict (user_id, concept_id, subject_id) do nothing;

  -- The answers, and everything else that follows an idea.
  update learn.probes set concept_id = p_keep where user_id = v_user and concept_id = p_retire;
  update learn.review_questions set concept_id = p_keep where user_id = v_user and concept_id = p_retire;
  update learn.next_outcomes set concept_id = p_keep where user_id = v_user and concept_id = p_retire;
  update learn.goals set concept_id = p_keep where user_id = v_user and concept_id = p_retire;
  update learn.readings set concept_id = p_keep where user_id = v_user and concept_id = p_retire;
  update learn.card_notes set concept_id = p_keep where user_id = v_user and concept_id = p_retire;
  update learn.catalogue_judgements set concept_id = p_keep where user_id = v_user and concept_id = p_retire;
  update learn.cell_evidence set concept_id = p_keep where user_id = v_user and concept_id = p_retire;
  update learn.vault_dust set concept_id = p_keep where user_id = v_user and concept_id = p_retire;

  update learn.feed_cards f set concept_id = p_keep
   where f.user_id = v_user and f.concept_id = p_retire
     and not (f.reason = 'lesson' and exists (
       select 1 from learn.feed_cards k
        where k.user_id = v_user and k.concept_id = p_keep and k.reason = 'lesson'));

  update learn.catalogue_links l set concept_id = p_keep
   where l.user_id = v_user and l.concept_id = p_retire
     and not exists (
       select 1 from learn.catalogue_links k
        where k.user_id = v_user and k.segment_id = l.segment_id and k.concept_id = p_keep);

  update learn.cell_claims c set concept_id = p_keep
   where c.user_id = v_user and c.concept_id = p_retire
     and not exists (
       select 1 from learn.cell_claims k where k.cell_id = c.cell_id and k.concept_id = p_keep);

  update learn.move_reviews m set concept_id = p_keep
   where m.user_id = v_user and m.concept_id = p_retire
     and m.prerequisite_id is distinct from p_keep
     and not exists (
       select 1 from learn.move_reviews k
        where k.concept_id = p_keep and k.kind = m.kind
          and k.prerequisite_id is not distinct from m.prerequisite_id);
  update learn.move_reviews m set prerequisite_id = p_keep
   where m.user_id = v_user and m.prerequisite_id = p_retire
     and m.concept_id <> p_keep
     and not exists (
       select 1 from learn.move_reviews k
        where k.concept_id = m.concept_id and k.kind = m.kind and k.prerequisite_id = p_keep);

  update learn.idea_place_members set concept_id = p_keep
   where user_id = v_user and concept_id = p_retire
     and not exists (select 1 from learn.idea_place_members k where k.concept_id = p_keep);
  update learn.idea_topic_parents set concept_id = p_keep
   where user_id = v_user and concept_id = p_retire
     and not exists (select 1 from learn.idea_topic_parents k where k.concept_id = p_keep);

  update learn.plan_pieces
     set concept_ids = array(
           select t.id from unnest(array_replace(concept_ids, p_retire, p_keep)) with ordinality t(id, n)
            group by t.id order by min(t.n))
   where user_id = v_user and p_retire = any (concept_ids);

  update learn.evidence_links l set target_id = p_keep
   where l.user_id = v_user and l.target_kind = 'idea' and l.target_id = p_retire
     and not exists (
       select 1 from learn.evidence_links k
        where k.user_id = v_user and k.target_kind = 'idea' and k.target_id = p_keep
          and k.source_kind = l.source_kind and k.source_id = l.source_id);
  update learn.evidence_links l set source_id = p_keep::text
   where l.user_id = v_user and l.source_kind = 'idea' and l.source_id = p_retire::text
     and l.target_id <> p_keep
     and not exists (
       select 1 from learn.evidence_links k
        where k.user_id = v_user and k.source_kind = 'idea' and k.source_id = p_keep::text
          and k.target_kind = l.target_kind and k.target_id = l.target_id);

  -- The state: the better evidence of the two. Tested beats declared beats
  -- inferred; between two of the same kind, the more recent.
  if v_retire_state.concept_id is not null then
    if v_keep_state.concept_id is null then
      update learn.concept_state set concept_id = p_keep
       where concept_id = p_retire and user_id = v_user;
    elsif (case v_retire_state.established when 'tested' then 3 when 'declared' then 2 else 1 end,
           coalesce(v_retire_state.tested_at, v_retire_state.declared_at, v_retire_state.updated_at))
        > (case v_keep_state.established when 'tested' then 3 when 'declared' then 2 else 1 end,
           coalesce(v_keep_state.tested_at, v_keep_state.declared_at, v_keep_state.updated_at)) then
      update learn.concept_state
         set state = v_retire_state.state,
             established = v_retire_state.established,
             misconception = v_retire_state.misconception,
             tested_at = v_retire_state.tested_at,
             declared_at = v_retire_state.declared_at,
             review_interval_days = v_retire_state.review_interval_days,
             review_due_on = v_retire_state.review_due_on
       where concept_id = p_keep and user_id = v_user;
    end if;
  end if;

  insert into learn.idea_pair_reviews
    (user_id, concept_low, concept_high, similarity, decision, kept_id, retired)
  values
    (v_user, least(p_keep, p_retire), greatest(p_keep, p_retire), p_similarity, 'merged', p_keep, v_retired)
  on conflict (user_id, concept_low, concept_high) do update
    set decision = 'merged', kept_id = excluded.kept_id, carried_to = null,
        retired = excluded.retired, similarity = excluded.similarity, created_at = now();

  -- Whatever did not move goes with it: its links, and any row the kept
  -- idea already had its own of.
  delete from learn.concepts where id = p_retire and user_id = v_user;
end;
$$;

comment on function learn.merge_ideas(uuid, uuid, double precision) is
  'Merge one of the caller''s ideas into another, the person having confirmed they are the same idea.';

revoke all on function learn.merge_ideas(uuid, uuid, double precision) from public, anon;
grant execute on function learn.merge_ideas(uuid, uuid, double precision) to authenticated;


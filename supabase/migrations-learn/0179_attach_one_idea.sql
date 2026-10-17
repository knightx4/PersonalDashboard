-- Attach one new idea to its frame topic as it is saved (plan #2313.2).
--
-- A feed idea used to be filed under a hidden survey subject made for its
-- article. That subject is no longer made: the idea is filed under a subject
-- the person chose, and placed on the map by its topic parent in
-- learn.idea_topic_parents. learn.attach_topic_parents() (0128) sets that
-- parent for every idea due, once a day; this does the same for one idea,
-- straight after it is saved, by the same rule: its nearest Level 4 topic
-- when the match is at least p_threshold, else its nearest Level 3 topic.
--
-- Returns the topic it attached to, or null when the idea has no embedding
-- or is not the named person's.

set search_path = learn, public, extensions;

create or replace function learn.attach_idea_topic_parent(
  p_concept uuid,
  p_user uuid,
  p_threshold real default 0.55
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = learn, public, extensions, pg_temp
as $$
declare
  v_e extensions.vector(512);
  v_l4 uuid;
  v_l4_sim real;
  v_l3 uuid;
  v_l3_sim real;
  v_topic uuid;
  v_sim real;
begin
  select subvector(c.embedding, 1, 512)::extensions.vector(512)
    into v_e
    from learn.concepts c
   where c.id = p_concept and c.user_id = p_user and c.embedding is not null;
  if v_e is null then
    return null;
  end if;

  select a.id, (1 - (a.embedding <=> v_e))::real
    into v_l4, v_l4_sim
    from learn.area_check_articles a
   where a.level = 4 and a.embedding is not null
   order by a.embedding <=> v_e
   limit 1;

  select a.id, (1 - (a.embedding <=> v_e))::real
    into v_l3, v_l3_sim
    from learn.area_check_articles a
   where a.level = 3 and a.embedding is not null
   order by a.embedding <=> v_e
   limit 1;

  if v_l4 is not null and v_l4_sim >= p_threshold then
    v_topic := v_l4;
    v_sim := v_l4_sim;
  elsif v_l3 is not null then
    v_topic := v_l3;
    v_sim := v_l3_sim;
  else
    return null;
  end if;

  insert into learn.idea_topic_parents (concept_id, user_id, topic_id, similarity, set_at)
  values (p_concept, p_user, v_topic, v_sim, now())
  on conflict (concept_id) do update
    set topic_id = excluded.topic_id, similarity = excluded.similarity, set_at = excluded.set_at;

  return v_topic;
end;
$$;

revoke all on function learn.attach_idea_topic_parent(uuid, uuid, real) from public, anon, authenticated;
grant execute on function learn.attach_idea_topic_parent(uuid, uuid, real) to service_role;

comment on function learn.attach_idea_topic_parent(uuid, uuid, real) is
  'Sets one idea''s topic parent as it is saved, by the rule learn.attach_topic_parents uses for the daily sweep (plan #2313.2).';

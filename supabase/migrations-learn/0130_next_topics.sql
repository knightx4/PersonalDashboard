-- The next topics beside what you know (plan #2016.6).
--
-- learn.next_topic_candidates(p_user_id, p_lit, p_per) reads, for each topic
-- the caller says is lit, its p_per nearest Level 4 topics by title vector
-- that are not lit themselves, and for each of those the active goal it sits
-- closest to. The caller works out which topics are lit (lib/learn/evidence/
-- topic-state.ts) and ranks the rows (lib/learn/map/next-topics.ts); this
-- function only does the vector reads PostgREST cannot.
--
-- A goal is placed by two kinds of stored vector, and the nearest of either
-- counts: the field it is placed in (or every field of its domain when it is
-- placed at a whole domain), and the ideas on its track. Fields and ideas are
-- embedded at 1024 dimensions and topics at 512; the Voyage 4 vectors are
-- matryoshka, so the first 512 dimensions are compared, as 0128 does.
--
-- Nothing here calls a model. Security invoker: through the session RLS keeps
-- the goals and ideas to the person's own, and under the service role
-- p_user_id names them.
--
-- learn.feed_cards.beside_topic is the lit topic a Learn now card's topic
-- sits beside, so the card's why line can name it. Null on every other card.

set search_path = learn, public, extensions;

alter table learn.feed_cards add column if not exists beside_topic text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'feed_cards_beside_topic_ck') then
    alter table learn.feed_cards add constraint feed_cards_beside_topic_ck
      check (beside_topic is null or (length(beside_topic) between 1 and 300));
  end if;
end;
$$;

comment on column learn.feed_cards.beside_topic is
  'For a card on a topic next to one the person knows: the known topic it sits beside (plan #2016.6).';

create or replace function learn.next_topic_candidates(
  p_user_id uuid,
  p_lit uuid[],
  p_per integer default 5
)
returns table (
  topic_id uuid,
  title text,
  beside_id uuid,
  beside_title text,
  similarity real,
  aim_id uuid,
  aim_name text,
  aim_closeness real
)
language sql
stable
security invoker
set search_path = learn, public, extensions, pg_temp
as $$
  with lit as materialized (
    select a.id, a.title, a.embedding
      from learn.area_check_articles a
     where a.id = any (coalesce(p_lit, '{}'::uuid[]))
       and a.embedding is not null
  ),
  aim_vectors as materialized (
    select a.id as aim_id, a.name as aim_name, subvector(f.embedding, 1, 512)::vector(512) as v
      from learn.aims a
      join learn.area_fields f
        on f.id = a.field_id or (a.field_id is null and f.domain_id = a.domain_id)
     where a.user_id = p_user_id and a.archived_at is null and f.embedding is not null
    union all
    select a.id, a.name, subvector(c.embedding, 1, 512)::vector(512)
      from learn.aims a
      join learn.concept_subjects cs on cs.subject_id = a.subject_id
      join learn.concepts c on c.id = cs.concept_id
     where a.user_id = p_user_id and a.archived_at is null and c.embedding is not null
  ),
  near as (
    select n.id as topic_id, n.title, l.id as beside_id, l.title as beside_title, n.sim, n.embedding
      from lit l
      cross join lateral (
        select t.id, t.title, t.embedding, (1 - (t.embedding <=> l.embedding))::real as sim
          from learn.area_check_articles t
         where t.level = 4
           and t.embedding is not null
           and t.id <> l.id
           and not (t.id = any (coalesce(p_lit, '{}'::uuid[])))
         order by t.embedding <=> l.embedding
         limit least(greatest(coalesce(p_per, 5), 1), 10)
      ) n
  )
  select near.topic_id, near.title, near.beside_id, near.beside_title, near.sim,
         best.aim_id, best.aim_name, best.closeness
    from near
    left join lateral (
      select av.aim_id, av.aim_name, (1 - (av.v <=> near.embedding))::real as closeness
        from aim_vectors av
       order by av.v <=> near.embedding
       limit 1
    ) best on true;
$$;

revoke all on function learn.next_topic_candidates(uuid, uuid[], integer) from public, anon;
grant execute on function learn.next_topic_candidates(uuid, uuid[], integer) to authenticated, service_role;

comment on function learn.next_topic_candidates(uuid, uuid[], integer) is
  'The nearest Level 4 topics beside each lit topic, with the active goal each sits closest to (plan #2016.6).';

-- Parents for topics and ideas (plan #2016.2).
--
-- Idea Space nests: field, Level 3 topic, Level 4 topic, then the person's
-- ideas. Two links make that so, both worked out from the stored embeddings
-- with no model call:
--
--   learn.area_check_articles.parent_id
--       A Level 4 topic's Level 3 parent: the Level 3 article whose title
--       vector is nearest its own. A Level 3 topic has none; its place in a
--       field is the field_id the area check already gave it, and a Level 4
--       topic reads its field through its parent rather than carrying a copy
--       (a field_id on an unplaced row would read as placed elsewhere).
--       parent_similarity is the cosine similarity of the pair.
--
--   learn.idea_topic_parents
--       An idea's topic parent: its nearest Level 4 topic when the match is
--       at least p_threshold (0.55, which on the first 60 ideas separated
--       "Defensive wall" for a fortification idea from "Variance" for a note
--       called churn_types), else its nearest Level 3 topic. One row per idea.
--       Kept in a table of its own so refreshing it does not touch
--       learn.concepts.updated_at.
--
-- Ideas are embedded at 1024 dimensions and topics at 512. The Voyage 4
-- vectors are matryoshka, a narrower vector being the head of the wider one,
-- so an idea is compared by its first 512 dimensions; cosine distance does
-- not need them re-normalised.
--
-- learn.attach_topic_parents() does both, only for what is due: a Level 4
-- topic with no parent, and an idea with none, edited since, or older than
-- the newest topic. The daily embedding run calls it.

set search_path = learn, public, extensions;

alter table learn.area_check_articles
  add column if not exists parent_id uuid references learn.area_check_articles (id) on delete set null;
alter table learn.area_check_articles
  add column if not exists parent_similarity real;

alter table learn.area_check_articles drop constraint if exists area_check_articles_parent_ck;
alter table learn.area_check_articles add constraint area_check_articles_parent_ck
  check (parent_id is null or (level = 4 and parent_id <> id));

create index if not exists area_check_articles_parent_idx
  on learn.area_check_articles (parent_id);

create table if not exists learn.idea_topic_parents (
  concept_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  topic_id uuid not null references learn.area_check_articles (id) on delete cascade,
  similarity real not null,
  set_at timestamptz not null default now(),
  constraint idea_topic_parents_concept_fk
    foreign key (concept_id, user_id) references learn.concepts (id, user_id)
    on delete cascade
);

create index if not exists idea_topic_parents_topic_idx on learn.idea_topic_parents (topic_id);
create index if not exists idea_topic_parents_user_idx on learn.idea_topic_parents (user_id);

alter table learn.idea_topic_parents enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'idea_topic_parents' and policyname = 'idea_topic_parents_read'
  ) then
    create policy idea_topic_parents_read on learn.idea_topic_parents for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.idea_topic_parents from anon, authenticated;
grant select on learn.idea_topic_parents to authenticated;
grant select, insert, update, delete on learn.idea_topic_parents to service_role;

comment on table learn.idea_topic_parents is
  'The topic each idea sits under on Idea Space: nearest Level 4 topic when the match is strong, else nearest Level 3 (plan #2016.2).';

create or replace function learn.attach_topic_parents(
  p_threshold real default 0.55,
  p_topic_limit integer default 3000
)
returns table (topics_attached integer, ideas_attached integer)
language plpgsql
volatile
security invoker
set search_path = learn, public, extensions, pg_temp
as $$
declare
  v_topics integer := 0;
  v_ideas integer := 0;
begin
  -- Level 4 topics with no parent: nearest Level 3 title vector.
  with l3 as materialized (
    select id, embedding from learn.area_check_articles
     where level = 3 and embedding is not null
  ),
  due as (
    select id, embedding from learn.area_check_articles
     where level = 4 and parent_id is null and embedding is not null
     order by id
     limit greatest(coalesce(p_topic_limit, 0), 0)
  ),
  best as (
    select d.id, n.pid, n.sim
      from due d
      cross join lateral (
        select l3.id as pid, (1 - (l3.embedding <=> d.embedding))::real as sim
          from l3
         order by l3.embedding <=> d.embedding
         limit 1
      ) n
  ),
  done as (
    update learn.area_check_articles a
       set parent_id = best.pid, parent_similarity = best.sim
      from best
     where a.id = best.id
    returning 1
  )
  select count(*)::integer into v_topics from done;

  -- Ideas with no parent, edited since, or older than the newest topic.
  with due as (
    select c.id, c.user_id, subvector(c.embedding, 1, 512)::extensions.vector(512) as e
      from learn.concepts c
      left join learn.idea_topic_parents p on p.concept_id = c.id
     where c.embedding is not null
       and (
         p.concept_id is null
         or p.set_at < c.updated_at
         or p.set_at < (select max(created_at) from learn.area_check_articles)
       )
  ),
  l4 as (
    select d.id, n.tid, n.sim
      from due d
      cross join lateral (
        select a.id as tid, (1 - (a.embedding <=> d.e))::real as sim
          from learn.area_check_articles a
         where a.level = 4 and a.embedding is not null
         order by a.embedding <=> d.e
         limit 1
      ) n
  ),
  l3 as materialized (
    select id, embedding from learn.area_check_articles
     where level = 3 and embedding is not null
  ),
  l3n as (
    select d.id, n.tid, n.sim
      from due d
      cross join lateral (
        select l3.id as tid, (1 - (l3.embedding <=> d.e))::real as sim
          from l3
         order by l3.embedding <=> d.e
         limit 1
      ) n
  ),
  chosen as (
    select d.id, d.user_id,
           case when l4.sim >= p_threshold then l4.tid else l3n.tid end as tid,
           case when l4.sim >= p_threshold then l4.sim else l3n.sim end as sim
      from due d
      join l4 on l4.id = d.id
      join l3n on l3n.id = d.id
  ),
  done as (
    insert into learn.idea_topic_parents (concept_id, user_id, topic_id, similarity, set_at)
    select id, user_id, tid, sim, now() from chosen
    on conflict (concept_id) do update
      set topic_id = excluded.topic_id, similarity = excluded.similarity, set_at = excluded.set_at
    returning 1
  )
  select count(*)::integer into v_ideas from done;

  return query select v_topics, v_ideas;
end;
$$;

revoke all on function learn.attach_topic_parents(real, integer) from public, anon, authenticated;
grant execute on function learn.attach_topic_parents(real, integer) to service_role;

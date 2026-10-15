-- Drafting a topic (docs/LEARN-LEVELS-SPEC.md, "Drafting a topic"; plan #2138.2).
--
-- A draft is an ordinary row of learn.topics with status 'draft', its cells
-- and its links to topics already on the map. Two things a draft carries that
-- 0133 had no place for:
--
--   asked    the goal the person named, in their words, when the topic was
--            drafted from one. Shown on the draft so the person can tell
--            whether the topic answers what they asked.
--   wanted   topics the draft's links need that the map does not have yet,
--            each with its scope and the levels the link would join. They are
--            drafted by their own call only when the person asks for one, and
--            the entry is removed then.
--
-- And one function: the topics nearest a topic's scope, which the draft page
-- shows beside the draft so the person can merge or keep both. Matching is on
-- the scope embedding (0133) by the same model, plus an exact name match, so a
-- topic drafted twice under one name is found even before its scope is
-- embedded.

set search_path = learn, public, extensions;

alter table learn.topics add column if not exists asked text;
alter table learn.topics add column if not exists wanted jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'topics_asked_ck' and conrelid = 'learn.topics'::regclass
  ) then
    alter table learn.topics add constraint topics_asked_ck check (asked is null or asked <> '');
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'topics_wanted_ck' and conrelid = 'learn.topics'::regclass
  ) then
    alter table learn.topics add constraint topics_wanted_ck check (jsonb_typeof(wanted) = 'array');
  end if;
end;
$$;

comment on column learn.topics.asked is
  'The goal the person named when this topic was drafted from one, in their words. Null for a topic drafted another way.';
comment on column learn.topics.wanted is
  'Topics this one''s links need that the map does not have: [{name, scope, from_level, level, why}]. Each is drafted only when the person asks, and leaves this list then.';

-- The topics nearest one topic, closest first: other topics of the same
-- account whose scope was embedded by the same model and is at least
-- `min_similarity` close (cosine, 1 is identical), and any whose name is the
-- same ignoring case, which count as 1. Security invoker, so RLS keeps it to
-- the caller's own topics; `p_topic_id` must be one of them.
create or replace function learn.nearest_topics(
  p_topic_id uuid,
  match_limit int default 3,
  min_similarity double precision default 0.8
)
returns table (
  id uuid,
  name text,
  scope text,
  status text,
  ceiling smallint,
  similarity double precision
)
language sql
stable
security invoker
set search_path = learn, extensions, pg_temp
as $$
  with self as materialized (
    select t.id, t.user_id, t.name, t.scope_embedding, t.embedding_model
      from learn.topics t
     where t.id = p_topic_id
  ),
  scored as (
    select o.id, o.name, o.scope, o.status, o.ceiling,
           case
             when lower(o.name) = lower(self.name) then 1::double precision
             when o.scope_embedding is not null and self.scope_embedding is not null
                  and o.embedding_model = self.embedding_model
               then (1 - (o.scope_embedding <=> self.scope_embedding))::double precision
             else null
           end as similarity
      from self
      join learn.topics o on o.user_id = self.user_id and o.id <> self.id
  )
  select s.id, s.name, s.scope, s.status, s.ceiling, s.similarity
    from scored s
   where s.similarity is not null and s.similarity >= min_similarity
   order by s.similarity desc, s.name
   limit least(greatest(coalesce(match_limit, 3), 1), 10);
$$;

revoke all on function learn.nearest_topics(uuid, int, double precision) from public, anon;
grant execute on function learn.nearest_topics(uuid, int, double precision) to authenticated, service_role;

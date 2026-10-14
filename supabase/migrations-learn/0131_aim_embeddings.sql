-- A vector for each learning goal, so the next topics are ranked by the goal
-- itself (plan #2016.6).
--
-- The goals were placed only by their field, and on the live account all four
-- sit in "Economics, business and finance", so the field could not tell one
-- goal from another. Each goal's name and what the person means by it are now
-- embedded once by the daily embedding run, as the fields are (voyage-4-lite,
-- 1024 dimensions), and learn.next_topic_candidates reads that vector first.
-- A goal not embedded yet still counts by its field, as in 0130. A rename or a
-- new line clears the vector, so the next daily run embeds the new wording.

set search_path = learn, public, extensions;

alter table learn.aims add column if not exists embedding vector(1024);
alter table learn.aims add column if not exists embedding_model text;

comment on column learn.aims.embedding is
  'The goal''s name and line, embedded by the daily run; ranks the next topics (plan #2016.6).';

create or replace function learn.aims_clear_embedding()
returns trigger
language plpgsql
set search_path = learn, public, pg_temp
as $$
begin
  if new.name is distinct from old.name or new.about is distinct from old.about then
    new.embedding := null;
    new.embedding_model := null;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'aims_clear_embedding_trg') then
    create trigger aims_clear_embedding_trg
      before update of name, about on learn.aims
      for each row execute function learn.aims_clear_embedding();
  end if;
end;
$$;

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
  active as materialized (
    select a.id, a.name, a.embedding, a.field_id, a.domain_id, a.subject_id
      from learn.aims a
     where a.user_id = p_user_id and a.archived_at is null
  ),
  aim_vectors as materialized (
    -- The goal's own words, once embedded.
    select a.id as aim_id, a.name as aim_name, subvector(a.embedding, 1, 512)::vector(512) as v
      from active a
     where a.embedding is not null
    union all
    -- Until then, the field it is placed in, or every field of its domain.
    select a.id, a.name, subvector(f.embedding, 1, 512)::vector(512)
      from active a
      join learn.area_fields f
        on f.id = a.field_id or (a.field_id is null and f.domain_id = a.domain_id)
     where a.embedding is null and f.embedding is not null
    union all
    -- And the ideas on its track.
    select a.id, a.name, subvector(c.embedding, 1, 512)::vector(512)
      from active a
      join learn.concept_subjects cs on cs.subject_id = a.subject_id
      join learn.concepts c on c.id = cs.concept_id
     where c.embedding is not null
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

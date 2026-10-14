-- Ideas linked to your work history (plan #2006.5).
--
-- An idea you used at work gets a link in learn.evidence_links (learn 0121)
-- to the passage of your history that shows it. The history is the latest
-- résumé (job_search.resume_versions) and the notes in the vault's Career
-- folder: the summary of your time at EY, the interview talking points and
-- the rest, and the job application notes under Career/Job Applications.
--
-- learn.work_passages, one row per passage of a few sentences:
--   origin        'resume', 'career' (a Career note about what you did) or
--                 'application' (a note on what a job wants).
--   source_id     the résumé version or the vault note it came from.
--   source_title  its label or note title, for the basis sentence.
--   block_id      for a note, the obsidian.note_blocks row it copies.
--   body          the passage; first_line is its first line, quoted in the
--                 basis.
--   text_hash     the passage's hash, so a passage that has not changed keeps
--                 its id and its vector.
--   weight        how much a link from it counts: the résumé and Career notes
--                 fully, application notes 0.4, since they say what a job
--                 wants rather than what you did.
--   embedding     voyage-4-lite, the model ideas use. A note's passage copies
--                 the vector the vault already has for its block; a résumé
--                 passage is embedded by the daily run.
--
-- A copy worked out from the résumé and the notes, which are the sources, so
-- the catalogue lists it as not one.

set search_path = learn, public, extensions;

create table if not exists learn.work_passages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  origin text not null,
  source_id uuid not null,
  source_title text not null,
  block_id uuid,
  position integer not null default 0,
  body text not null,
  first_line text not null,
  text_hash text not null,
  weight real not null,
  embedding extensions.vector(1024),
  embedding_model text,
  updated_at timestamptz not null default now(),
  constraint work_passages_origin_ck check (origin in ('resume', 'career', 'application')),
  constraint work_passages_body_ck check (body <> ''),
  constraint work_passages_first_line_ck check (first_line <> ''),
  constraint work_passages_weight_ck check (weight >= 0 and weight <= 1),
  constraint work_passages_passage_uq unique (user_id, source_id, text_hash)
);

create index if not exists work_passages_user_idx on learn.work_passages (user_id, origin);

alter table learn.work_passages enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'work_passages' and policyname = 'work_passages_read'
  ) then
    create policy work_passages_read on learn.work_passages for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.work_passages from anon, authenticated;
grant select on learn.work_passages to authenticated;
grant all on learn.work_passages to service_role;

comment on table learn.work_passages is
  'Passages of the résumé and the Career notes, embedded, for linking ideas to work history (plan #2006.5).';

-- The first line of a passage worth quoting: markdown marks, callout markers
-- and wiki-link brackets taken off, a line of text preferred over a heading
-- or a callout's title, cut at 120 characters.
create or replace function learn.work_first_line(p_text text)
returns text
language sql
immutable
set search_path = learn, public
as $$
  with lines as (
    select t.ord,
           t.l ~ '^\s*(?:#|>\s*\[!)' as heading,
           btrim(regexp_replace(
             regexp_replace(
               regexp_replace(t.l, '\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', '\1', 'g'),
               '\*\*|__|\[![A-Za-z-]+\][+-]?', '', 'g'),
             '^[\s#>*•-]+', '')) as line
    from regexp_split_to_table(coalesce(p_text, ''), E'\r?\n') with ordinality as t(l, ord)
  ),
  picked as (
    select coalesce(
      (select line from lines where not heading and length(line) >= 20 order by ord limit 1),
      (select line from lines where not heading and line <> '' order by ord limit 1),
      (select line from lines where line <> '' order by ord limit 1),
      ''
    ) as line
  )
  select case when length(line) > 120 then left(line, 119) || '…' else line end
  from picked;
$$;

-- The passages, brought up to date in one go (`p_passages` is the latest
-- résumé, split by the daily run, as a JSON array of {position, body,
-- first_line, text_hash}; `p_resume_id` is null when there is no résumé):
--   the résumé's passages are written without a vector, and one whose text
--   has not changed keeps its id and its vector;
--   the Career notes' passages are copied from the vault's embedded blocks of
--   every note under Career/ that is not deleted, application notes (Career/
--   Job Applications/) at 0.4 and the rest at full weight. Blocks with no
--   vector yet wait for the vault's own embedding pass;
--   any passage in neither set (an older résumé, a changed block, a note that
--   has gone) is removed.
-- Returns how many passages there are.
create or replace function learn.sync_work_passages(
  p_user_id uuid,
  p_resume_id uuid,
  p_title text,
  p_passages jsonb
)
returns integer
language plpgsql
security invoker
set search_path = learn, public, extensions
as $$
declare
  kept integer;
begin
  with resume as (
    select distinct on (text_hash)
           'resume'::text as origin, p_resume_id as source_id,
           coalesce(nullif(p_title, ''), 'résumé') as source_title, null::uuid as block_id,
           position, body, first_line, text_hash, 1::real as weight,
           null::extensions.vector(1024) as embedding, null::text as embedding_model
    from (
      select (p ->> 'position')::integer as position, p ->> 'body' as body,
             p ->> 'first_line' as first_line, p ->> 'text_hash' as text_hash
      from jsonb_array_elements(coalesce(p_passages, '[]'::jsonb)) as p
    ) incoming
    where p_resume_id is not null and coalesce(body, '') <> ''
      and coalesce(first_line, '') <> '' and coalesce(text_hash, '') <> ''
    order by text_hash, position
  ),
  blocks as (
    select b.id as block_id, n.id as note_id, n.title, b.position, b.text_hash,
           b.embedding, b.embedding_model,
           substring(n.body from b.start_offset + 1 for b.end_offset - b.start_offset) as body,
           case when n.path like 'Career/Job Applications/%' then 'application' else 'career' end
             as origin
    from obsidian.notes n
    join obsidian.note_blocks b on b.note_id = n.id and b.user_id = n.user_id
    where n.user_id = p_user_id
      and n.deleted_at is null
      and n.path like 'Career/%'
      and b.embedding is not null
  ),
  notes as (
    select distinct on (note_id, text_hash)
           origin, note_id as source_id, coalesce(nullif(title, ''), 'a Career note') as source_title,
           block_id, position, body, learn.work_first_line(body) as first_line, text_hash,
           (case when origin = 'application' then 0.4 else 1 end)::real as weight,
           embedding, embedding_model
    from blocks
    where btrim(coalesce(body, '')) <> ''
    order by note_id, text_hash, position
  ),
  current_passages as (
    select * from resume
    union all
    select * from notes where first_line <> ''
  ),
  written as (
    insert into learn.work_passages
      (user_id, origin, source_id, source_title, block_id, position, body, first_line,
       text_hash, weight, embedding, embedding_model)
    select p_user_id, origin, source_id, source_title, block_id, position, body, first_line,
           text_hash, weight, embedding, embedding_model
    from current_passages
    on conflict (user_id, source_id, text_hash) do update
      set origin = excluded.origin,
          source_title = excluded.source_title,
          block_id = excluded.block_id,
          position = excluded.position,
          body = excluded.body,
          first_line = excluded.first_line,
          weight = excluded.weight,
          -- A résumé passage keeps the vector the daily run gave it.
          embedding = coalesce(excluded.embedding, learn.work_passages.embedding),
          embedding_model = coalesce(excluded.embedding_model, learn.work_passages.embedding_model),
          updated_at = now()
    returning id
  ),
  -- Disjoint from what is written: only passages in neither set.
  removed as (
    delete from learn.work_passages w
    where w.user_id = p_user_id
      and not exists (
        select 1 from current_passages c
        where c.source_id = w.source_id and c.text_hash = w.text_hash
      )
    returning w.id
  )
  select (select count(*) from written)::integer into kept;
  return kept;
end;
$$;

-- Each idea linked to the work passages it matches at 0.6 or above, at most
-- five per idea, the strongest by weight times similarity. A link found
-- before and not found now is removed, so a passage that has gone or changed
-- takes its links with it. Returns how many links there are.
create or replace function learn.refresh_work_evidence(p_user_id uuid)
returns integer
language plpgsql
security invoker
set search_path = learn, public, extensions
as $$
declare
  kept integer;
begin
  with pairs as (
    select c.id as concept_id, w.id as passage_id, w.weight, w.origin, w.source_title,
           w.first_line,
           (1 - (w.embedding <=> c.embedding))::real as similarity
    from learn.work_passages w
    join learn.concepts c
      on c.user_id = w.user_id and c.embedding is not null
     and c.embedding_model is not distinct from w.embedding_model
    where w.user_id = p_user_id and w.embedding is not null
  ),
  ranked as (
    select *, row_number() over (
             partition by concept_id
             order by weight * similarity desc, similarity desc, passage_id
           ) as rank
    from pairs
    where similarity >= 0.6
  ),
  matches as (
    select concept_id, passage_id, least(similarity, 1)::real as similarity, weight,
           case origin
             when 'resume' then format('From your résumé: "%s"', first_line)
             when 'application'
               then format('From your application notes in %s: "%s"', source_title, first_line)
             else format('From your note %s: "%s"', source_title, first_line)
           end as basis
    from ranked
    where rank <= 5
  ),
  written as (
    insert into learn.evidence_links
      (user_id, target_kind, target_id, source_kind, source_id, similarity, weight, basis,
       found_at)
    select p_user_id, 'idea', concept_id, 'work', passage_id::text, similarity, weight, basis,
           now()
    from matches
    on conflict (user_id, target_kind, target_id, source_kind, source_id) do update
      set similarity = excluded.similarity,
          weight = excluded.weight,
          basis = excluded.basis
    returning id
  ),
  -- Disjoint from what is written: only links this run did not find.
  removed as (
    delete from learn.evidence_links e
    where e.user_id = p_user_id and e.source_kind = 'work' and e.target_kind = 'idea'
      and not exists (
        select 1 from matches m
        where m.concept_id = e.target_id and m.passage_id::text = e.source_id
      )
    returning e.id
  )
  select (select count(*) from written)::integer into kept;
  return kept;
end;
$$;

-- The latest résumé to read passages from: the default one, or else the most
-- recently changed, with text.
create or replace function learn.latest_resume(p_user_id uuid)
returns table (id uuid, label text, text_content text)
language sql
stable
security invoker
set search_path = learn, public
as $$
  select r.id, r.label, r.text_content
  from job_search.resume_versions r
  where r.user_id = p_user_id and btrim(coalesce(r.text_content, '')) <> ''
  order by r.is_default desc nulls last, r.updated_at desc
  limit 1;
$$;

revoke all on function learn.work_first_line(text) from public, anon;
grant execute on function learn.work_first_line(text) to authenticated, service_role;
revoke all on function learn.sync_work_passages(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function learn.sync_work_passages(uuid, uuid, text, jsonb) to service_role;
revoke all on function learn.refresh_work_evidence(uuid) from public, anon, authenticated;
grant execute on function learn.refresh_work_evidence(uuid) to service_role;
revoke all on function learn.latest_resume(uuid) from public, anon, authenticated;
grant execute on function learn.latest_resume(uuid) to service_role;

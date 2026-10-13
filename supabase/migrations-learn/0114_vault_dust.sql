-- Vault notes as dust on Idea Space (plan #1997.6).
--
-- The night-sky map draws each vault note as a faint speck behind the ideas,
-- beside the idea it is most like. Working that out compares every note's
-- embedding with every idea's, which takes several seconds for a vault of a
-- thousand notes, too slow for a page visit. So the daily run works it out
-- once (learn.refresh_vault_dust) and the page reads the answer here.
--
-- learn.vault_dust, one row per vault note with an embedding:
--   concept_id  the idea the note is most like.
--   similarity  how alike they are (cosine, -1 to 1). The map draws a less
--               alike note further from its idea.
--
-- Bookkeeping worked out from the embeddings, not what the person wrote, so
-- not a source. A note whose embedding goes, or whose idea goes, takes its
-- row with it.

set search_path = learn, public, extensions;

create table if not exists learn.vault_dust (
  note_id uuid primary key
    references obsidian.note_embeddings (note_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  concept_id uuid not null,
  similarity real not null,
  updated_at timestamptz not null default now(),
  constraint vault_dust_concept_fk
    foreign key (concept_id, user_id) references learn.concepts (id, user_id)
    on delete cascade
);

create index if not exists vault_dust_user_idx on learn.vault_dust (user_id);
create index if not exists vault_dust_concept_idx on learn.vault_dust (concept_id);

alter table learn.vault_dust enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'vault_dust' and policyname = 'vault_dust_read'
  ) then
    create policy vault_dust_read on learn.vault_dust for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.vault_dust from anon, authenticated;
grant select on learn.vault_dust to authenticated;
grant select, insert, update, delete on learn.vault_dust to service_role;

-- One batch of a person's notes, in note id order after `p_after`: each is
-- matched with its most alike idea and written. Returns the last note id of a
-- full batch, for the next call to start after, or null once the notes run
-- out. Batches keep each call to about a second.
create or replace function learn.refresh_vault_dust(
  p_user_id uuid,
  p_after uuid default null,
  p_limit integer default 200
)
returns uuid
language plpgsql
security invoker
set search_path = learn, public, extensions
as $$
declare
  last_id uuid;
  batch_size integer;
begin
  with batch as (
    select n.note_id, n.embedding
    from obsidian.note_embeddings n
    where n.user_id = p_user_id
      and (p_after is null or n.note_id > p_after)
    order by n.note_id
    limit p_limit
  ),
  nearest as (
    select b.note_id, c.id as concept_id,
           (1 - (b.embedding <=> c.embedding))::real as similarity
    from batch b
    cross join lateral (
      select k.id, k.embedding
      from learn.concepts k
      where k.user_id = p_user_id and k.embedding is not null
      order by k.embedding <=> b.embedding
      limit 1
    ) c
  ),
  written as (
    insert into learn.vault_dust (note_id, user_id, concept_id, similarity, updated_at)
    select note_id, p_user_id, concept_id, similarity, now() from nearest
    on conflict (note_id) do update
      set concept_id = excluded.concept_id,
          similarity = excluded.similarity,
          updated_at = now()
    returning note_id
  )
  select (select count(*) from written)::integer,
         (select b.note_id from batch b order by b.note_id desc limit 1)
    into batch_size, last_id;

  if batch_size < p_limit then
    return null;
  end if;
  return last_id;
end;
$$;

revoke all on function learn.refresh_vault_dust(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function learn.refresh_vault_dust(uuid, uuid, integer) to service_role;

comment on table learn.vault_dust is
  'Each vault note matched with the idea it is most like, for the dust behind the Idea Space map; worked out daily (plan #1997.6).';

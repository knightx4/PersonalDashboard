-- One shared territory, versioned cells and cited rows
-- (docs/LEARN-LEVELS-SPEC.md, "Tables"; plan #2138.10, decided on #2138.9).
--
-- The map of topics becomes one map shared by every account, as the catalogue
-- and the frame already are. What a person knows stays theirs.
--
--   topics, topic_cells, cell_links
--       user_id may be null, and null means shared. A signed-in account reads
--       shared rows and its own, and writes only its own; shared rows are
--       written by the service role. A row keeps the owner it was written
--       with.
--   topic_cells.version
--       starts at 1 and rises by one each time the descriptor is reworded.
--   cell_evidence.cell_version
--       the version of the cell the verdict was given against, stamped from
--       the cell when the row is written, so a reworded level keeps the
--       evidence given against its earlier wording readable as such.
--   source, canonicality on topics, topic_cells and cell_links
--       where the row came from (a syllabus, a textbook, an exam body's list,
--       a role's requirement line), and how settled it is: canonical,
--       practitioner, emerging or personal. Null until a draft cites it.
--   topics.refines_article_id
--       the frame topic (learn.area_check_articles) the topic refines.
--
-- Shared rows cannot carry user_id in composite foreign keys, so every key
-- into these three tables becomes a key on id alone, and one trigger keeps
-- the owner rule the composite keys kept:
--
--   a cell has its topic's owner, exactly;
--   any other row may point at a shared row or at a row of its own owner,
--   and a shared row may point only at shared rows.
--
-- The cycle check now walks shared links and the writer's own links only,
-- which is the map that writer reads. Every one of these tables is empty on
-- the live project when this runs, apart from learn.lenses, whose rows point
-- at no topic.

set search_path = learn, public, extensions;

-- ---------------------------------------------------------------------------
-- Owners become optional on the territory.
-- ---------------------------------------------------------------------------
alter table learn.topics alter column user_id drop not null;
alter table learn.topic_cells alter column user_id drop not null;
alter table learn.cell_links alter column user_id drop not null;

-- ---------------------------------------------------------------------------
-- Keys into the territory on id alone.
-- ---------------------------------------------------------------------------
alter table learn.topic_cells drop constraint topic_cells_topic_fk;
alter table learn.topic_cells add constraint topic_cells_topic_fk
  foreign key (topic_id) references learn.topics (id) on delete cascade;

alter table learn.cell_links drop constraint cell_links_requiring_fk;
alter table learn.cell_links add constraint cell_links_requiring_fk
  foreign key (requiring_cell_id) references learn.topic_cells (id) on delete cascade;

alter table learn.cell_links drop constraint cell_links_required_fk;
alter table learn.cell_links add constraint cell_links_required_fk
  foreign key (required_cell_id) references learn.topic_cells (id) on delete cascade;

alter table learn.cell_claims drop constraint cell_claims_cell_fk;
alter table learn.cell_claims add constraint cell_claims_cell_fk
  foreign key (cell_id) references learn.topic_cells (id) on delete cascade;

alter table learn.cell_evidence drop constraint cell_evidence_cell_fk;
alter table learn.cell_evidence add constraint cell_evidence_cell_fk
  foreign key (cell_id) references learn.topic_cells (id) on delete cascade;

alter table learn.cell_questions drop constraint cell_questions_cell_fk;
alter table learn.cell_questions add constraint cell_questions_cell_fk
  foreign key (cell_id) references learn.topic_cells (id) on delete cascade;

alter table learn.probes drop constraint probes_cell_fk;
alter table learn.probes add constraint probes_cell_fk
  foreign key (cell_id) references learn.topic_cells (id) on delete set null;

alter table learn.move_reviews drop constraint move_reviews_cell_fk;
alter table learn.move_reviews add constraint move_reviews_cell_fk
  foreign key (cell_id) references learn.topic_cells (id) on delete set null;

alter table learn.lens_targets drop constraint lens_targets_topic_fk;
alter table learn.lens_targets add constraint lens_targets_topic_fk
  foreign key (topic_id) references learn.topics (id) on delete cascade;

alter table learn.link_reviews drop constraint link_reviews_link_fk;
alter table learn.link_reviews add constraint link_reviews_link_fk
  foreign key (link_id) references learn.cell_links (id) on delete set null;

create index if not exists cell_claims_cell_idx on learn.cell_claims (cell_id);
create index if not exists link_reviews_link_idx on learn.link_reviews (link_id) where link_id is not null;

-- ---------------------------------------------------------------------------
-- The owner rule.
--
-- Arguments: the column holding the reference, the table it points into, and
-- 'same' when the owners must match exactly. Security definer, so the check
-- sees the row it points at even where the writer's policies would hide it;
-- a missing row is left to the foreign key to report.
-- ---------------------------------------------------------------------------
create or replace function learn.territory_owner_check()
returns trigger
language plpgsql
security definer
set search_path = learn, public, pg_temp
as $$
declare
  v_ref uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
  v_found boolean;
  v_owner uuid;
begin
  if v_ref is null then
    return new;
  end if;
  execute format('select true, user_id from learn.%I where id = $1', tg_argv[1])
    into v_found, v_owner
    using v_ref;
  if v_found is null then
    return new;
  end if;
  if coalesce(tg_argv[2], '') = 'same' then
    if v_owner is distinct from new.user_id then
      raise exception '%: % names a row of another account, or a shared row from a personal one', tg_table_name, tg_argv[0]
        using errcode = 'foreign_key_violation';
    end if;
  elsif v_owner is not null and v_owner is distinct from new.user_id then
    raise exception '%: % names a row of another account', tg_table_name, tg_argv[0]
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

revoke all on function learn.territory_owner_check() from public, anon, authenticated;

create trigger topic_cells_owner_ck
  before insert or update of topic_id, user_id on learn.topic_cells
  for each row execute function learn.territory_owner_check('topic_id', 'topics', 'same');

create trigger cell_links_requiring_owner_ck
  before insert or update of requiring_cell_id, user_id on learn.cell_links
  for each row execute function learn.territory_owner_check('requiring_cell_id', 'topic_cells');

create trigger cell_links_required_owner_ck
  before insert or update of required_cell_id, user_id on learn.cell_links
  for each row execute function learn.territory_owner_check('required_cell_id', 'topic_cells');

create trigger cell_claims_owner_ck
  before insert or update of cell_id, user_id on learn.cell_claims
  for each row execute function learn.territory_owner_check('cell_id', 'topic_cells');

create trigger cell_evidence_owner_ck
  before insert or update of cell_id, user_id on learn.cell_evidence
  for each row execute function learn.territory_owner_check('cell_id', 'topic_cells');

create trigger cell_questions_owner_ck
  before insert or update of cell_id, user_id on learn.cell_questions
  for each row execute function learn.territory_owner_check('cell_id', 'topic_cells');

create trigger probes_cell_owner_ck
  before insert or update of cell_id, user_id on learn.probes
  for each row execute function learn.territory_owner_check('cell_id', 'topic_cells');

create trigger move_reviews_cell_owner_ck
  before insert or update of cell_id, user_id on learn.move_reviews
  for each row execute function learn.territory_owner_check('cell_id', 'topic_cells');

create trigger lens_targets_owner_ck
  before insert or update of topic_id, user_id on learn.lens_targets
  for each row execute function learn.territory_owner_check('topic_id', 'topics');

create trigger link_reviews_owner_ck
  before insert or update of link_id, user_id on learn.link_reviews
  for each row execute function learn.territory_owner_check('link_id', 'cell_links');

-- A territory row keeps its owner: what hangs off it was checked against
-- that owner.
create or replace function learn.territory_owner_fixed()
returns trigger
language plpgsql
set search_path = learn, public, pg_temp
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception '%: a row keeps the owner it was written with; write a new row instead', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function learn.territory_owner_fixed() from public, anon, authenticated;

create trigger topics_owner_fixed
  before update of user_id on learn.topics
  for each row execute function learn.territory_owner_fixed();

create trigger topic_cells_owner_fixed
  before update of user_id on learn.topic_cells
  for each row execute function learn.territory_owner_fixed();

create trigger cell_links_owner_fixed
  before update of user_id on learn.cell_links
  for each row execute function learn.territory_owner_fixed();

-- ---------------------------------------------------------------------------
-- The cycle check walks the map its writer reads: shared links and the
-- writer's own. Otherwise as in 0133.
-- ---------------------------------------------------------------------------
create or replace function learn.reject_cell_link_cycle()
returns trigger
language plpgsql
set search_path = learn, public, pg_temp
as $$
declare
  v_topic uuid;
  v_level smallint;
begin
  select topic_id, level into v_topic, v_level
    from learn.topic_cells where id = new.requiring_cell_id;

  if exists (select 1 from learn.topic_cells where id = new.required_cell_id and topic_id = v_topic) then
    raise exception 'cell_links: both cells are on one topic, which the level chain already links'
      using errcode = 'check_violation';
  end if;

  if exists (
    with recursive reach (topic_id, level) as (
      select c.topic_id, c.level from learn.topic_cells c where c.id = new.required_cell_id
      union
      select rc.topic_id, rc.level
        from reach r
        join learn.topic_cells qc on qc.topic_id = r.topic_id and qc.level <= r.level
        join learn.cell_links l on l.requiring_cell_id = qc.id and l.id is distinct from new.id
          and (l.user_id is null or l.user_id is not distinct from new.user_id)
        join learn.topic_cells rc on rc.id = l.required_cell_id
    )
    select 1 from reach where topic_id = v_topic and level >= v_level
  ) then
    raise exception 'cell_links: % -> % would close a cycle', new.requiring_cell_id, new.required_cell_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Versions.
-- ---------------------------------------------------------------------------
alter table learn.topic_cells add column if not exists version smallint not null default 1;
alter table learn.topic_cells add constraint topic_cells_version_ck check (version >= 1);

comment on column learn.topic_cells.version is
  'Starts at 1 and rises by one each time the descriptor is reworded (plan #2138.10). Evidence records the version it was given against.';

create or replace function learn.topic_cells_bump_version()
returns trigger
language plpgsql
set search_path = learn, public, pg_temp
as $$
begin
  if new.descriptor is distinct from old.descriptor then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

revoke all on function learn.topic_cells_bump_version() from public, anon, authenticated;

create trigger topic_cells_bump_version
  before update on learn.topic_cells
  for each row execute function learn.topic_cells_bump_version();

alter table learn.cell_evidence add column if not exists cell_version smallint not null;

comment on column learn.cell_evidence.cell_version is
  'The version of the cell (topic_cells.version) this verdict was given against, stamped from the cell when the row is written (plan #2138.10).';

create or replace function learn.cell_evidence_stamp_version()
returns trigger
language plpgsql
security definer
set search_path = learn, public, pg_temp
as $$
begin
  select c.version into new.cell_version from learn.topic_cells c where c.id = new.cell_id;
  return new;
end;
$$;

revoke all on function learn.cell_evidence_stamp_version() from public, anon, authenticated;

create trigger cell_evidence_stamp_version
  before insert or update of cell_id on learn.cell_evidence
  for each row execute function learn.cell_evidence_stamp_version();

-- ---------------------------------------------------------------------------
-- Where each row came from.
-- ---------------------------------------------------------------------------
alter table learn.topics add column if not exists source text;
alter table learn.topics add column if not exists canonicality text;
alter table learn.topic_cells add column if not exists source text;
alter table learn.topic_cells add column if not exists canonicality text;
alter table learn.cell_links add column if not exists source text;
alter table learn.cell_links add column if not exists canonicality text;

alter table learn.topics add constraint topics_source_ck check (source is null or source <> '');
alter table learn.topics add constraint topics_canonicality_ck
  check (canonicality is null or canonicality in ('canonical', 'practitioner', 'emerging', 'personal'));
alter table learn.topic_cells add constraint topic_cells_source_ck check (source is null or source <> '');
alter table learn.topic_cells add constraint topic_cells_canonicality_ck
  check (canonicality is null or canonicality in ('canonical', 'practitioner', 'emerging', 'personal'));
alter table learn.cell_links add constraint cell_links_source_ck check (source is null or source <> '');
alter table learn.cell_links add constraint cell_links_canonicality_ck
  check (canonicality is null or canonicality in ('canonical', 'practitioner', 'emerging', 'personal'));

comment on column learn.topics.source is
  'Where the topic came from: a syllabus, a textbook, an exam body''s outcome list, a role''s requirement line. Null until a draft cites one.';
comment on column learn.topics.canonicality is
  'How settled the topic is: canonical, practitioner, emerging or personal. Null until a draft says.';
comment on column learn.topic_cells.source is 'Where this level''s descriptor came from. Null until a draft cites one.';
comment on column learn.topic_cells.canonicality is 'canonical, practitioner, emerging or personal. Null until a draft says.';
comment on column learn.cell_links.source is 'Where this requirement came from. Null until a draft cites one.';
comment on column learn.cell_links.canonicality is 'canonical, practitioner, emerging or personal. Null until a draft says.';

alter table learn.topics add column if not exists refines_article_id uuid
  references learn.area_check_articles (id) on delete set null;

create index if not exists topics_refines_article_idx on learn.topics (refines_article_id)
  where refines_article_id is not null;

comment on column learn.topics.refines_article_id is
  'The frame topic (learn.area_check_articles) this topic refines. Null when it refines none.';

comment on column learn.topics.user_id is
  'The account a personal topic belongs to. Null for a topic on the shared map, which every account reads and only the service role writes.';

-- ---------------------------------------------------------------------------
-- Policies: the 0133 policies still give each account its own rows for every
-- command, and a shared row (no owner) matches none of them. These add
-- reading shared rows, and nothing else: no account writes one.
-- ---------------------------------------------------------------------------
create policy topics_read_shared on learn.topics for select to authenticated
  using (user_id is null);

create policy topic_cells_read_shared on learn.topic_cells for select to authenticated
  using (user_id is null);

create policy cell_links_read_shared on learn.cell_links for select to authenticated
  using (user_id is null);

-- ---------------------------------------------------------------------------
-- The topics nearest one topic now look across the shared map as well as the
-- topic owner's own (or, for a shared topic, the caller's own). Otherwise as
-- in 0135.
-- ---------------------------------------------------------------------------
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
      join learn.topics o
        on o.id <> self.id
       and (o.user_id is null or o.user_id = coalesce(self.user_id, (select auth.uid())))
  )
  select s.id, s.name, s.scope, s.status, s.ceiling, s.similarity
    from scored s
   where s.similarity is not null and s.similarity >= min_similarity
   order by s.similarity desc, s.name
   limit least(greatest(coalesce(match_limit, 3), 1), 10);
$$;

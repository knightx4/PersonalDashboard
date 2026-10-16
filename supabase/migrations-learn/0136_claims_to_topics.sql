-- Moving the claims graph onto topics (docs/LEARN-LEVELS-SPEC.md, "Migration
-- from the claims graph"; plan #2138.4).
--
-- The move runs one subject at a time from /learn/topics/review: a call puts
-- each concept on a topic and a level, states become evidence, edges become
-- links, and the subject becomes a lens. What this migration adds for it:
--
--   probes.cell_id          step 5: the cell an old probe's concept landed on,
--                           so the probe history reads against the new map.
--   cell_evidence.concept_id the concept a carried-over verdict came from, so
--                           moving that concept to another level moves its
--                           evidence with it. Null on every verdict an answer
--                           writes.
--   graph_moves             one row per subject moved, or tried and failed,
--                           with the lens it became. The review page counts
--                           what is left from it and shows each failure.
--   move_reviews            what the move could not settle alone: a concept
--                           the call was unsure where to put, and an edge that
--                           runs downwards inside one topic. The person
--                           answers each one.
--
-- The old tables are not touched. They stay readable until the new screens
-- have replaced every read of them, and dropping them waits for the person.

set search_path = learn, public, extensions;

-- ---------------------------------------------------------------------------
-- probes.cell_id
-- ---------------------------------------------------------------------------
alter table learn.probes add column if not exists cell_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'probes_cell_fk' and conrelid = 'learn.probes'::regclass
  ) then
    alter table learn.probes add constraint probes_cell_fk
      foreign key (cell_id, user_id) references learn.topic_cells (id, user_id) on delete set null (cell_id);
  end if;
end;
$$;

create index if not exists probes_cell_idx on learn.probes (cell_id) where cell_id is not null;

-- ---------------------------------------------------------------------------
-- cell_evidence.concept_id
-- ---------------------------------------------------------------------------
alter table learn.cell_evidence add column if not exists concept_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cell_evidence_concept_fk' and conrelid = 'learn.cell_evidence'::regclass
  ) then
    alter table learn.cell_evidence add constraint cell_evidence_concept_fk
      foreign key (concept_id, user_id) references learn.concepts (id, user_id) on delete set null (concept_id);
  end if;
end;
$$;

create index if not exists cell_evidence_concept_idx on learn.cell_evidence (concept_id) where concept_id is not null;

comment on column learn.cell_evidence.concept_id is
  'The claims-graph concept this verdict was carried over from (plan #2138.4). Null on evidence an answer or a declaration wrote.';

-- ---------------------------------------------------------------------------
-- graph_moves: one row per subject.
-- ---------------------------------------------------------------------------
create table if not exists learn.graph_moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null,
  status text not null,
  -- The lens the subject became, once moved.
  lens_id uuid,
  -- Why it failed, in a sentence the page can show. Null once moved.
  detail text,
  concepts_placed integer not null default 0,
  topics_drafted integer not null default 0,
  moved_at timestamptz not null default now(),

  constraint graph_moves_status_ck check (status in ('moved', 'failed')),
  constraint graph_moves_detail_ck check ((status = 'failed') = (detail is not null)),
  constraint graph_moves_subject_uq unique (subject_id),
  constraint graph_moves_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete cascade,
  constraint graph_moves_lens_fk
    foreign key (lens_id, user_id) references learn.lenses (id, user_id) on delete set null (lens_id)
);

create index if not exists graph_moves_user_idx on learn.graph_moves (user_id);
create index if not exists graph_moves_lens_idx on learn.graph_moves (lens_id) where lens_id is not null;

-- ---------------------------------------------------------------------------
-- move_reviews: what the person answers.
--
--   assignment  concept_id was put on cell_id, and the call said why it was
--               unsure. Answered 'kept', or 'moved' to another level.
--   edge        prerequisite_id sits higher on one topic than concept_id,
--               which needs it. Answered 'kept' (the levels stand and the edge
--               goes) or 'moved' (the prerequisite moves down to the
--               dependent's level).
-- ---------------------------------------------------------------------------
create table if not exists learn.move_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null,
  kind text not null,
  concept_id uuid not null,
  prerequisite_id uuid,
  cell_id uuid,
  why text not null,
  decision text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),

  constraint move_reviews_kind_ck check (kind in ('assignment', 'edge')),
  constraint move_reviews_shape_ck check (
    (kind = 'edge' and prerequisite_id is not null) or (kind = 'assignment' and prerequisite_id is null)
  ),
  constraint move_reviews_why_ck check (why <> ''),
  constraint move_reviews_decision_ck check (decision is null or decision in ('kept', 'moved')),
  constraint move_reviews_decided_ck check ((decision is null) = (decided_at is null)),
  constraint move_reviews_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete cascade,
  constraint move_reviews_concept_fk
    foreign key (concept_id, user_id) references learn.concepts (id, user_id) on delete cascade,
  constraint move_reviews_prerequisite_fk
    foreign key (prerequisite_id, user_id) references learn.concepts (id, user_id) on delete cascade,
  constraint move_reviews_cell_fk
    foreign key (cell_id, user_id) references learn.topic_cells (id, user_id) on delete set null (cell_id)
);

create unique index if not exists move_reviews_assignment_uq on learn.move_reviews (concept_id)
  where kind = 'assignment';
create unique index if not exists move_reviews_edge_uq on learn.move_reviews (concept_id, prerequisite_id)
  where kind = 'edge';
create index if not exists move_reviews_user_idx on learn.move_reviews (user_id, created_at);
create index if not exists move_reviews_subject_idx on learn.move_reviews (subject_id);
create index if not exists move_reviews_prerequisite_idx on learn.move_reviews (prerequisite_id)
  where prerequisite_id is not null;
create index if not exists move_reviews_cell_idx on learn.move_reviews (cell_id) where cell_id is not null;

-- ---------------------------------------------------------------------------
-- Row level security: each account's own rows.
-- ---------------------------------------------------------------------------
alter table learn.graph_moves enable row level security;
alter table learn.move_reviews enable row level security;

create policy graph_moves_all on learn.graph_moves for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy move_reviews_all on learn.move_reviews for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on learn.graph_moves, learn.move_reviews from anon;

grant select, insert, update, delete on learn.graph_moves, learn.move_reviews to authenticated, service_role;

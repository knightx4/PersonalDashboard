-- Each unit of a learning goal's track is split into pieces (plan #1140).
--
-- A piece is one sitting of about 20 to 30 minutes: a few of the unit's ideas,
-- taught together, in a suggested order. Pieces are written once the unit's
-- ideas are laid out, one call per unit, and only for goal tracks, since the
-- study plan built on them belongs to a learning goal.
--
--   ordinal      the piece's place in its unit, from 1. The suggested order;
--                nothing is locked by it.
--   title        short, for the plan's list.
--   concept_ids  the ideas the piece covers, in teaching order. Every idea of
--                the unit falls in exactly one piece when they are written;
--                an idea deleted later just drops out of the list.
--   passed_at    when the piece's check was passed (plan #1141). Null until
--                then. Progress on a plan is the count of these.
--
-- A unit's pieces go with the unit, and the unit with its track.

set search_path = learn, public, extensions;

create table if not exists learn.plan_pieces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null,
  unit_id uuid not null,

  ordinal integer not null,
  title text not null,
  concept_ids uuid[] not null default '{}',
  passed_at timestamptz,

  -- The model that wrote the pieces, for the day one turns out wrong.
  write_model text,
  created_at timestamptz not null default now(),

  constraint plan_pieces_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete cascade,
  constraint plan_pieces_unit_fk
    foreign key (unit_id, user_id) references learn.curriculum_units (id, user_id) on delete cascade,
  constraint plan_pieces_ordinal_ck check (ordinal >= 1),
  constraint plan_pieces_title_ck check (btrim(title) <> ''),
  constraint plan_pieces_order_uq unique (unit_id, ordinal)
);

create index if not exists plan_pieces_user_idx on learn.plan_pieces (user_id);
create index if not exists plan_pieces_subject_idx on learn.plan_pieces (subject_id);

alter table learn.plan_pieces enable row level security;

drop policy if exists plan_pieces_all on learn.plan_pieces;
create policy plan_pieces_all on learn.plan_pieces for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on learn.plan_pieces from anon;
-- Update for passed_at, from the piece's page.
grant select, insert, update on learn.plan_pieces to authenticated;
grant select, insert, update, delete on learn.plan_pieces to service_role;

comment on table learn.plan_pieces is
  'Pieces of about half an hour that each unit of a learning goal''s track is split into (plan #1140).';

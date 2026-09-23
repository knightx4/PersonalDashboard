-- A fixed curriculum at the top of every track.
--
-- docs/LEARN-GRAPH-SPEC.md, "The curriculum". A track used to be only the
-- chains its goals laid out, so its shape was whatever you happened to ask
-- about. The owner wants tracks you create to be rigid instead: when the track
-- is made, a model writes the high-level curriculum once, as an ordered list
-- of units, and it does not change after that. Detail comes later, one unit at
-- a time, when you open a unit and its chain of ideas is laid out as a goal
-- inside the track.
--
--   ordinal   the unit's place in the curriculum, from 1. Fixed.
--   title     short, for the list: "Price elasticity".
--   covers    one or two sentences on what the unit teaches.
--   outcome   what you can do once it is learned, in one sentence.
--
-- A goal opened from a unit points back at it with goals.unit_id, which is how
-- the track page files each chain under its unit. A goal with no unit is shown
-- after the curriculum, as something asked outside it.
--
-- Nothing here is edited or reordered from the app: units are written once and
-- deleted only with their track.

set search_path = learn, public, extensions;

create table if not exists learn.curriculum_units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null,

  ordinal integer not null,
  title text not null,
  covers text not null,
  outcome text not null,

  -- The model that wrote the curriculum, for the day one turns out wrong.
  write_model text,
  created_at timestamptz not null default now(),

  constraint curriculum_units_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id) on delete cascade,
  constraint curriculum_units_ordinal_ck check (ordinal >= 1),
  constraint curriculum_units_title_ck check (btrim(title) <> ''),
  constraint curriculum_units_order_uq unique (subject_id, ordinal)
);

alter table learn.curriculum_units drop constraint if exists curriculum_units_user_id_uq;
alter table learn.curriculum_units add constraint curriculum_units_user_id_uq unique (id, user_id);

create index if not exists curriculum_units_user_idx on learn.curriculum_units (user_id);

alter table learn.curriculum_units enable row level security;

drop policy if exists curriculum_units_all on learn.curriculum_units;
create policy curriculum_units_all on learn.curriculum_units for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on learn.curriculum_units from anon;
-- Insert and select only: a curriculum is written once and goes with its
-- track, on the cascade.
grant select, insert on learn.curriculum_units to authenticated;
grant select, insert, update, delete on learn.curriculum_units to service_role;

-- The unit a goal was opened from.
alter table learn.goals add column if not exists unit_id uuid;
alter table learn.goals drop constraint if exists goals_unit_fk;
alter table learn.goals add constraint goals_unit_fk
  foreign key (unit_id, user_id) references learn.curriculum_units (id, user_id)
  on delete set null (unit_id);

create index if not exists goals_unit_idx on learn.goals (unit_id) where unit_id is not null;

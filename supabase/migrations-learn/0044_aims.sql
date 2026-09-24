-- Learning goals: a few broad things the person wants to learn, and how well
-- (plan #895, this table is #896).
--
-- The page calls them Goals. The table is `aims` because `learn.goals` already
-- holds something else: a concept typed into a track (LEARN-GRAPH-SPEC).
--
-- An aim is one of two kinds:
--
--   An open subject, such as "city design and urbanism". `list_source` is
--   null, and the aim is placed in one field of the area grid, or in a whole
--   domain when it spans several, the way a track is (#898). Placement is
--   written after the aim is saved, so a new aim has neither for a minute.
--
--   A fixed list to get through. `list_source = 'level3'` is every Level 3
--   vital article, which is already stored in learn.area_check_articles. It
--   covers every field, so it is never placed, and a person has at most one
--   that is not archived.
--
-- `depth` is how well the person wants to know it: familiar, solid or deep.
-- Learn now maps these to the card depths working, advanced and specialist
-- (lib/learn/aims.ts).
--
-- Archiving takes an aim out of the list and out of Learn now, and keeps the
-- row, so cards already drawn for it can still say which aim they were for.
--
-- The rows belong to their owner, who adds, edits and archives them through
-- their own session, like tracks.

set search_path = learn, public, extensions;

create table if not exists learn.aims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  name text not null,
  -- What the person means by it, in a line. Optional.
  about text,
  depth text not null default 'familiar',
  list_source text,

  field_id uuid references learn.area_fields (id) on delete restrict,
  domain_id uuid references learn.area_domains (id) on delete restrict,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint aims_name_ck check (btrim(name) <> '' and length(name) <= 200),
  constraint aims_about_ck check (about is null or length(about) <= 1000),
  constraint aims_depth_ck check (depth in ('familiar', 'solid', 'deep')),
  constraint aims_list_source_ck check (list_source is null or list_source in ('level3')),
  constraint aims_placement_target_ck check (field_id is null or domain_id is null),
  -- A list covers every field, so it is not placed.
  constraint aims_list_unplaced_ck check (
    list_source is null or (field_id is null and domain_id is null)
  )
);

-- What the Goals page and the Learn now draw read: one person's aims, active first.
create index if not exists aims_user_idx on learn.aims (user_id, archived_at, created_at);
-- Foreign keys, for the restrict check when an area is removed.
create index if not exists aims_field_idx on learn.aims (field_id) where field_id is not null;
create index if not exists aims_domain_idx on learn.aims (domain_id) where domain_id is not null;
-- One active aim per list per person, so adding the Level 3 goal twice is refused.
create unique index if not exists aims_user_list_active_uq
  on learn.aims (user_id, list_source)
  where list_source is not null and archived_at is null;

drop trigger if exists aims_touch_updated_at on learn.aims;
create trigger aims_touch_updated_at
  before update on learn.aims
  for each row execute function learn.touch_updated_at();

alter table learn.aims enable row level security;

drop policy if exists aims_all on learn.aims;
create policy aims_all on learn.aims for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on learn.aims to authenticated;
grant all on learn.aims to service_role;
revoke all on table learn.aims from anon;

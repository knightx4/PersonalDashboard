-- Where each vault theme sits in the areas.
--
-- docs/LEARN-AREAS-SPEC.md, "Placement". The grid is only useful once the
-- things you write about are placed in it: a theme goes in one field, or, when
-- it covers a whole domain, in that domain. Placing the themes is what lets
-- the Know page shade each field by how much of your writing falls there.
--
-- The placement lives in Learn because Learn never writes to the vault map
-- (KNOWLEDGE-SPEC.md, "Nothing crosses back"). It does point at the theme with
-- a foreign key, unlike `track_offers`, which keeps a theme's id and name
-- without one so that a Never survives a rename. A placement is a statement
-- about one theme and means nothing once that theme is gone, so it goes with
-- it; a theme a later sweep renames or merges is simply placed again, at about
-- a tenth of a cent.
--
-- Three outcomes, and the table holds all of them so a theme is only ever sent
-- to the model once:
--
--   field     the ordinary case.
--   domain    the theme covers a whole domain (the umbrella case).
--   neither   the theme is not about any field of study: logistics, errands,
--             a story's plot. Kept as a row with a basis, so the pass does not
--             ask again, and shown nowhere on the grid.

set search_path = learn, public, extensions;

create table if not exists learn.theme_fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  theme_id uuid not null,

  field_id uuid references learn.area_fields (id) on delete restrict,
  domain_id uuid references learn.area_domains (id) on delete restrict,
  -- The next best field, when the model named one. A theme that sits between
  -- two fields is common in a vault written across subjects, and the second
  -- field is worth showing when the placement is questioned.
  runner_up_id uuid references learn.area_fields (id) on delete set null,
  confidence text not null,
  -- Why it sits here, in a sentence. Shown next to the placement.
  basis text not null,
  model text,

  -- True once you moved it yourself. The pass never overwrites such a row.
  moved_by_hand boolean not null default false,

  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint theme_fields_theme_fk
    foreign key (theme_id, user_id) references obsidian.themes (id, user_id) on delete cascade,
  constraint theme_fields_theme_uq unique (user_id, theme_id),
  constraint theme_fields_confidence_ck check (confidence in ('clear', 'close', 'none')),
  constraint theme_fields_basis_ck check (btrim(basis) <> ''),
  -- A field or a domain, never both. Neither is the unplaced outcome above.
  constraint theme_fields_target_ck check (field_id is null or domain_id is null)
);

-- What the grid reads: everything one account placed in each field.
create index if not exists theme_fields_user_field_idx on learn.theme_fields (user_id, field_id);
create index if not exists theme_fields_user_domain_idx
  on learn.theme_fields (user_id, domain_id)
  where domain_id is not null;

drop trigger if exists theme_fields_touch_updated_at on learn.theme_fields;
create trigger theme_fields_touch_updated_at
  before update on learn.theme_fields
  for each row execute function learn.touch_updated_at();

alter table learn.theme_fields enable row level security;

drop policy if exists theme_fields_select on learn.theme_fields;
create policy theme_fields_select on learn.theme_fields for select to authenticated
  using (user_id = (select auth.uid()));
-- Update is how a placement is moved by hand. The pass itself runs as the
-- service role and needs no policy.
drop policy if exists theme_fields_update on learn.theme_fields;
create policy theme_fields_update on learn.theme_fields for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, update on learn.theme_fields to authenticated;
grant all on learn.theme_fields to service_role;
revoke all on table learn.theme_fields from anon;

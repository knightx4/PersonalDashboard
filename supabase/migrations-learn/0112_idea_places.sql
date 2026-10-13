-- Places on Idea Space (plan #1997.2).
--
-- A place is a group of 4 to 25 ideas that sit close together, with a short
-- name such as "Chip shortages and the bullwhip". The daily run works them
-- out again from the idea embeddings (lib/learn/places), keeps the id and
-- name of a place that comes back, and names a place again only once its
-- ideas have changed by more than a third since it was named.
--
-- learn.idea_places, one row per place:
--   name           the short name, or null until the naming call has given one.
--   named_members  the ideas the place held when it was named, which later
--                  runs compare against; empty while it has no name.
--   named_at       when the name was given.
--   member_count   how many ideas it holds now.
--
-- learn.idea_place_members, one row per idea in a place. An idea is in one
-- place at most, so the idea is the key. Ideas in no place have no row.
--
-- Both are bookkeeping worked out from the ideas, not what the person wrote,
-- so neither is a source. The daily run writes them with the service role;
-- the person's session only reads them.

set search_path = learn, public, extensions;

create table if not exists learn.idea_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text,
  named_members uuid[] not null default '{}',
  named_at timestamptz,
  member_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint idea_places_id_user_uq unique (id, user_id),
  constraint idea_places_name_check check (name is null or char_length(name) between 1 and 80)
);

create index if not exists idea_places_user_idx on learn.idea_places (user_id);

create table if not exists learn.idea_place_members (
  concept_id uuid primary key,
  place_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  constraint idea_place_members_place_fk
    foreign key (place_id, user_id) references learn.idea_places (id, user_id)
    on delete cascade,
  constraint idea_place_members_concept_fk
    foreign key (concept_id, user_id) references learn.concepts (id, user_id)
    on delete cascade
);

create index if not exists idea_place_members_place_idx on learn.idea_place_members (place_id);
create index if not exists idea_place_members_user_idx on learn.idea_place_members (user_id);

alter table learn.idea_places enable row level security;
alter table learn.idea_place_members enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'idea_places' and policyname = 'idea_places_read'
  ) then
    create policy idea_places_read on learn.idea_places for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'idea_place_members' and policyname = 'idea_place_members_read'
  ) then
    create policy idea_place_members_read on learn.idea_place_members for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end;
$$;

revoke all on learn.idea_places from anon, authenticated;
revoke all on learn.idea_place_members from anon, authenticated;
grant select on learn.idea_places to authenticated;
grant select on learn.idea_place_members to authenticated;
grant select, insert, update, delete on learn.idea_places to service_role;
grant select, insert, update, delete on learn.idea_place_members to service_role;

comment on table learn.idea_places is
  'Named groups of nearby ideas on Idea Space, worked out daily from the idea embeddings (plan #1997.2).';
comment on table learn.idea_place_members is
  'Which place each grouped idea is in; an idea is in one place at most (plan #1997.2).';

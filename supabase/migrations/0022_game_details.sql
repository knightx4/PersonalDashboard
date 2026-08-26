-- Board games as a second per-category detail table.
--
-- Same shape as book_details on purpose: a canonical id (BGG instead of ISBN),
-- the runner-up matches, and an explicit "needs confirmation" gate. A Catan
-- base box, its 5-6 player extension, and a 3D special edition are three very
-- different resale prices sharing one word on the spine.

set search_path = public, extensions;

do $$ begin
  create type game_resolution_source as enum ('bgg', 'upc_lookup', 'manual');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type game_condition as enum (
    'new_sealed',
    'like_new',
    'complete_used',
    'incomplete',
    'damaged'
  );
exception when duplicate_object then null;
end $$;

create table if not exists game_details (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items (id) on delete cascade,
  bgg_id integer,
  -- EAN-13 form of whatever was scanned.
  barcode text,
  year_published integer,
  publisher text,
  min_players integer,
  max_players integer,
  playing_time_minutes integer,
  condition game_condition,
  resolution_source game_resolution_source not null default 'manual',
  match_confidence numeric(4, 3),
  needs_confirmation boolean not null default false,
  candidates jsonb not null default '[]'::jsonb,
  confirmation_reason text,
  auto_imported boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_details_inventory_item_id_key unique (inventory_item_id),
  constraint game_details_year_ck
    check (year_published is null or (year_published >= 1000 and year_published <= 2100)),
  constraint game_details_players_ck
    check (
      (min_players is null or min_players > 0)
      and (max_players is null or max_players > 0)
      and (min_players is null or max_players is null or max_players >= min_players)
    ),
  constraint game_details_playing_time_ck
    check (playing_time_minutes is null or playing_time_minutes > 0),
  constraint game_details_match_confidence_ck
    check (
      match_confidence is null
      or (match_confidence >= 0 and match_confidence <= 1)
    ),
  constraint game_details_candidates_is_array_ck
    check (jsonb_typeof(candidates) = 'array')
);

create index if not exists game_details_bgg_id_idx on game_details (bgg_id)
  where bgg_id is not null;
create index if not exists game_details_barcode_idx on game_details (barcode)
  where barcode is not null;

drop trigger if exists game_details_touch_updated_at on game_details;
create trigger game_details_touch_updated_at
  before update on game_details
  for each row execute function public.touch_updated_at();

alter table game_details enable row level security;

drop policy if exists game_details_select on game_details;
create policy game_details_select on game_details for select to authenticated
  using (
    exists (
      select 1 from inventory_items i
      where i.id = inventory_item_id and i.user_id = (select auth.uid())
    )
  );
drop policy if exists game_details_insert on game_details;
create policy game_details_insert on game_details for insert to authenticated
  with check (
    exists (
      select 1 from inventory_items i
      where i.id = inventory_item_id and i.user_id = (select auth.uid())
    )
  );
drop policy if exists game_details_update on game_details;
create policy game_details_update on game_details for update to authenticated
  using (
    exists (
      select 1 from inventory_items i
      where i.id = inventory_item_id and i.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from inventory_items i
      where i.id = inventory_item_id and i.user_id = (select auth.uid())
    )
  );
drop policy if exists game_details_delete on game_details;
create policy game_details_delete on game_details for delete to authenticated
  using (
    exists (
      select 1 from inventory_items i
      where i.id = inventory_item_id and i.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on game_details to authenticated;

-- Board games get their own category so the shelf does not land in "other".
insert into categories (user_id, parent_id, name, slug, color)
select null, null, 'Board games', 'board-games', '#7C3AED'
where not exists (
  select 1 from categories where user_id is null and slug = 'board-games'
);

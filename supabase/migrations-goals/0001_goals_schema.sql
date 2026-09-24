-- The goals module: an eighth schema, for the things you are working towards
-- in your own life (docs/GOALS-SPEC.md, plan #923).
--
-- Eight tables, all under row level security from this first migration:
--
--   areas        directions that never finish: money, career, the city
--   items        goals and steps in one tree, as plan_items holds features
--                and steps in one table
--   history      one row per change to any of the others, written by trigger
--   captures     each sentence typed into the capture box, and what was filed
--   readings     dated numbers against a goal, a new row every time
--   periods      one row per rhythm per period, with target, count and kept
--   suggestions  what Claude suggested, your reaction, and whether you went
--   runs         one row per routine run
--
-- `item_goals` (a step counting towards a second goal) and `links` (a goal
-- pointing at a Learn aim or a job application) are in the spec's data sketch
-- too. They are left to the steps that use them, #925 and #931, which know
-- what they need to hold.
--
-- -- History --
--
-- The spec asks that every change be recorded, and that a write which forgets
-- to record itself cannot happen. So the record is not the app's job. An AFTER
-- trigger on every table below writes goals.history for each insert, update
-- and delete, with the old and new values and who made the change. Areas and
-- items are never deleted in normal use: removing one sets archived_at, which
-- the trigger records as `archive` rather than as a plain update.
--
-- Who made the change is read in this order:
--
--   1. The setting `goals.actor`, for SQL run directly: a routine working
--      through the Supabase connector runs `set local goals.actor = 'claude'`.
--   2. The request header `x-goals-actor`, which PostgREST passes to the
--      database as `request.headers`. The capture box sends `capture`.
--   3. Otherwise the role: a signed-in request is `me`, anything else (the
--      service role, or SQL with no session behind it) is `claude`.
--
-- The capture and the run a change came from are read the same way, from
-- `goals.capture_id` / `x-goals-capture` and `goals.run_id` / `x-goals-run`.
-- A signed-in person can set these headers on their own requests. That only
-- changes the label on their own history, which is theirs to mislabel.
--
-- history is append-only: authenticated and service_role get select on it and
-- nothing else, and the trigger function writes it as its owner.
--
-- Applied by scripts/db-reset.sh after migrations-todo. Nothing in here points
-- outside the schema except at auth.users.
--
-- `goals` collides with nothing Supabase ships.

create schema if not exists goals;

set search_path = goals, public, extensions;

-- ---------------------------------------------------------------------------
-- areas
-- ---------------------------------------------------------------------------
create table goals.areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  name text not null,
  position integer not null default 0,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint areas_name_ck check (btrim(name) <> '' and length(name) <= 200),
  -- Lets items point at (area_id, user_id) as one foreign key. Foreign keys
  -- bypass row level security, so a plain `references goals.areas (id)` would
  -- accept another account's area.
  constraint areas_id_user_key unique (id, user_id)
);

create index areas_user_position_idx on goals.areas (user_id, position)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- items -- the tree.
--
-- A goal sits under an area and has no kind. A step sits under a goal or
-- another step, to any depth, and has one of four kinds (spec, "The three
-- levels"). A rhythm step carries its target count and period.
--
-- status is the same four words for both levels: `proposed` until approved,
-- `open` while it is live, and `done` or `dropped` once closed. closed_at is
-- kept by a trigger from the status and is never written by hand.
-- ---------------------------------------------------------------------------
create table goals.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  level text not null,
  area_id uuid,
  parent_id uuid,

  kind text,
  status text not null default 'open',

  title text not null,
  detail text,
  acceptance text,
  fog text,
  resolution text,

  due_on date,
  on_todo boolean not null default false,
  approved_at timestamptz,
  position integer not null default 0,

  rhythm_count integer,
  rhythm_period text,

  closed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint items_id_user_key unique (id, user_id),

  -- No action rather than cascade: hard-deleting an area or a step that still
  -- has rows beneath it is refused, so a mistaken delete cannot take a tree
  -- with it. Deleting the account still clears everything, because the check
  -- runs at the end of the statement, after the cascade has removed the rows.
  constraint items_area_fk foreign key (area_id, user_id)
    references goals.areas (id, user_id),
  constraint items_parent_fk foreign key (parent_id, user_id)
    references goals.items (id, user_id),

  constraint items_level_ck check (level in ('goal', 'step')),
  constraint items_shape_ck check (
    (level = 'goal' and area_id is not null and parent_id is null and kind is null)
    or (level = 'step' and area_id is null and parent_id is not null and kind is not null)
  ),
  constraint items_parent_not_self_ck check (parent_id is null or parent_id <> id),
  constraint items_kind_ck check (kind is null or kind in ('mine', 'claude', 'decision', 'rhythm')),
  constraint items_status_ck check (status in ('proposed', 'open', 'done', 'dropped')),
  constraint items_closed_at_ck check ((status in ('done', 'dropped')) = (closed_at is not null)),

  constraint items_title_ck check (btrim(title) <> '' and length(title) <= 500),
  constraint items_detail_ck check (detail is null or length(detail) <= 20000),
  constraint items_acceptance_ck check (acceptance is null or length(acceptance) <= 4000),
  constraint items_fog_ck check (fog is null or (btrim(fog) <> '' and length(fog) <= 4000)),
  constraint items_resolution_ck check (resolution is null or length(resolution) <= 20000),

  -- Approval is once per goal (spec, "Approval"), so only a goal carries it.
  constraint items_approved_at_ck check (approved_at is null or level = 'goal'),
  -- Only a step can be shown on Todo; a goal is not a thing you tick.
  constraint items_on_todo_ck check (not on_todo or level = 'step'),

  constraint items_rhythm_ck check (
    (kind = 'rhythm') = (rhythm_count is not null and rhythm_period is not null)
    and (rhythm_count is null or rhythm_count between 1 and 100)
    and (rhythm_period is null or rhythm_period in ('day', 'week', 'month'))
  )
);

create index items_area_idx on goals.items (area_id, position) where area_id is not null;
create index items_parent_idx on goals.items (parent_id, position) where parent_id is not null;
create index items_user_open_idx on goals.items (user_id, level, status)
  where archived_at is null;
create index items_user_on_todo_idx on goals.items (user_id) where on_todo and archived_at is null;

-- ---------------------------------------------------------------------------
-- runs -- one row per routine run, as plan_runs is for the dev plan.
--
-- job says which schedule fired it: the daily run, the weekly research, or
-- one goal's Work on this button (item_id names the goal). What a run changed
-- is in history, where every row it wrote carries its run_id.
-- ---------------------------------------------------------------------------
create table goals.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  job text not null,
  item_id uuid,
  status text not null default 'started',

  routine_id text,
  external_id text,
  summary text,
  error text,

  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint runs_id_user_key unique (id, user_id),
  constraint runs_item_fk foreign key (item_id, user_id)
    references goals.items (id, user_id) on delete set null (item_id),

  constraint runs_job_ck check (job in ('daily', 'weekly', 'goal')),
  constraint runs_status_ck check (status in ('started', 'done', 'failed')),
  constraint runs_error_ck check (
    (status = 'failed' and error is not null) or (status <> 'failed' and error is null)
  ),
  constraint runs_error_length_ck check (error is null or length(error) <= 4000),
  constraint runs_summary_length_ck check (summary is null or length(summary) <= 20000),
  constraint runs_routine_id_length_ck check (routine_id is null or length(routine_id) <= 200),
  constraint runs_external_id_length_ck check (external_id is null or length(external_id) <= 200)
);

create index runs_user_created_idx on goals.runs (user_id, created_at desc);
create index runs_item_idx on goals.runs (item_id, created_at desc) where item_id is not null;

-- ---------------------------------------------------------------------------
-- captures -- the sentence as typed, and what was filed from it.
--
-- filed is the list of actions the filing call took, in order. An Undo marks
-- its entry with when it was undone rather than removing it, so the capture
-- keeps the whole story (spec, "Captures are kept whole").
-- ---------------------------------------------------------------------------
create table goals.captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  body text not null,
  filed jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint captures_id_user_key unique (id, user_id),
  constraint captures_body_ck check (btrim(body) <> '' and length(body) <= 4000),
  constraint captures_filed_ck check (jsonb_typeof(filed) = 'array')
);

create index captures_user_created_idx on goals.captures (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- readings -- a number against a goal on a date: a balance, a weight.
--
-- A new reading is a new row. The value on an earlier row is what it was on
-- that date, and the chart is drawn from all of them.
-- ---------------------------------------------------------------------------
create table goals.readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  item_id uuid not null,
  value numeric not null,
  read_on date not null default current_date,
  note text,
  capture_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint readings_item_fk foreign key (item_id, user_id)
    references goals.items (id, user_id) on delete cascade,
  constraint readings_capture_fk foreign key (capture_id, user_id)
    references goals.captures (id, user_id) on delete set null (capture_id),
  constraint readings_note_ck check (note is null or length(note) <= 2000)
);

create index readings_item_read_idx on goals.readings (item_id, read_on desc);
create index readings_capture_idx on goals.readings (capture_id) where capture_id is not null;

-- ---------------------------------------------------------------------------
-- periods -- one row per rhythm per period.
--
-- Stored rather than recomputed, so last March's kept or missed does not
-- depend on what the rhythm's target is today. kept is null while the period
-- is open and set when it is closed off.
-- ---------------------------------------------------------------------------
create table goals.periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  item_id uuid not null,
  starts_on date not null,
  ends_on date not null,
  target integer not null,
  count integer not null default 0,
  kept boolean,
  closed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint periods_item_fk foreign key (item_id, user_id)
    references goals.items (id, user_id) on delete cascade,
  constraint periods_item_start_key unique (item_id, starts_on),
  constraint periods_dates_ck check (ends_on > starts_on),
  constraint periods_target_ck check (target between 1 and 100),
  constraint periods_count_ck check (count >= 0),
  constraint periods_closed_ck check ((closed_at is null) = (kept is null))
);

-- ---------------------------------------------------------------------------
-- suggestions -- what the weekly research found, and what you did with it.
--
-- reaction is null until you press one, and `ignored` is written by the run
-- that closes the week for suggestions nobody reacted to. attended is whether
-- you then went, which is a separate fact from saying you would.
-- ---------------------------------------------------------------------------
create table goals.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  item_id uuid,
  run_id uuid,

  title text not null,
  detail text,
  url text,
  place text,
  source text,
  happens_on date,
  starts_at timestamptz,

  reaction text,
  reacted_at timestamptz,
  attended boolean,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint suggestions_item_fk foreign key (item_id, user_id)
    references goals.items (id, user_id) on delete set null (item_id),
  constraint suggestions_run_fk foreign key (run_id, user_id)
    references goals.runs (id, user_id) on delete set null (run_id),

  constraint suggestions_title_ck check (btrim(title) <> '' and length(title) <= 500),
  constraint suggestions_detail_ck check (detail is null or length(detail) <= 4000),
  constraint suggestions_url_ck check (url is null or (url ~ '^https?://' and length(url) <= 2000)),
  constraint suggestions_place_ck check (place is null or length(place) <= 500),
  constraint suggestions_source_ck check (source is null or length(source) <= 200),
  constraint suggestions_reaction_ck check (
    reaction is null or reaction in ('going', 'not_for_me', 'ignored')
  ),
  constraint suggestions_reacted_ck check ((reaction is null) = (reacted_at is null))
);

create index suggestions_user_created_idx on goals.suggestions (user_id, created_at desc);
create index suggestions_item_idx on goals.suggestions (item_id) where item_id is not null;
create index suggestions_run_idx on goals.suggestions (run_id) where run_id is not null;

-- ---------------------------------------------------------------------------
-- history -- one row per change to any table above. Append-only.
--
-- row_id is not a foreign key: the history of a row outlives the row. For an
-- insert, new_values is the whole row; for a delete, old_values is. For an
-- update, both hold only the columns that changed, updated_at aside, so a
-- row reads as "status: open -> done" rather than as two copies of the row.
-- ---------------------------------------------------------------------------
create table goals.history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,

  table_name text not null,
  row_id uuid not null,
  action text not null,
  old_values jsonb,
  new_values jsonb,

  actor text not null,
  capture_id uuid,
  run_id uuid,

  created_at timestamptz not null default now(),

  constraint history_table_ck check (
    table_name in ('areas', 'items', 'runs', 'captures', 'readings', 'periods', 'suggestions')
  ),
  constraint history_action_ck check (
    action in ('insert', 'update', 'archive', 'unarchive', 'delete')
  ),
  constraint history_actor_ck check (actor in ('me', 'claude', 'capture')),
  constraint history_values_ck check (
    (action = 'insert' and old_values is null and new_values is not null)
    or (action = 'delete' and old_values is not null and new_values is null)
    or (action in ('update', 'archive', 'unarchive') and old_values is not null and new_values is not null)
  )
);

create index history_user_created_idx on goals.history (user_id, created_at desc);
create index history_row_idx on goals.history (row_id, created_at);
create index history_capture_idx on goals.history (capture_id) where capture_id is not null;
create index history_run_idx on goals.history (run_id) where run_id is not null;

-- ---------------------------------------------------------------------------
-- updated_at, and closed_at on items. Goals' own copy of touch_updated_at, as
-- every other schema keeps its own.
-- ---------------------------------------------------------------------------
create or replace function goals.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter function goals.touch_updated_at() set search_path = goals;
revoke all on function goals.touch_updated_at() from public, anon, authenticated;

create trigger areas_touch_updated_at before update on goals.areas
  for each row execute function goals.touch_updated_at();
create trigger items_touch_updated_at before update on goals.items
  for each row execute function goals.touch_updated_at();
create trigger runs_touch_updated_at before update on goals.runs
  for each row execute function goals.touch_updated_at();
create trigger captures_touch_updated_at before update on goals.captures
  for each row execute function goals.touch_updated_at();
create trigger readings_touch_updated_at before update on goals.readings
  for each row execute function goals.touch_updated_at();
create trigger periods_touch_updated_at before update on goals.periods
  for each row execute function goals.touch_updated_at();
create trigger suggestions_touch_updated_at before update on goals.suggestions
  for each row execute function goals.touch_updated_at();

-- closed_at follows status: set when an item is done or dropped, cleared when
-- it is reopened, and left alone when it moves between the two closed states.
create or replace function goals.items_closed_at()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('done', 'dropped') then
    if tg_op = 'INSERT' or old.status not in ('done', 'dropped') then
      new.closed_at := now();
    else
      new.closed_at := coalesce(old.closed_at, now());
    end if;
  else
    new.closed_at := null;
  end if;
  return new;
end;
$$;

alter function goals.items_closed_at() set search_path = goals;
revoke all on function goals.items_closed_at() from public, anon, authenticated;

create trigger items_closed_at before insert or update of status, closed_at on goals.items
  for each row execute function goals.items_closed_at();

-- ---------------------------------------------------------------------------
-- The history trigger.
--
-- Security definer because history grants nobody insert: the rows are written
-- by this function as its owner and by nothing else. search_path is empty and
-- every name is qualified, as a definer function must.
-- ---------------------------------------------------------------------------
create or replace function goals.request_value(setting text, header text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  value text;
begin
  value := nullif(btrim(current_setting(setting, true)), '');
  if value is not null then
    return value;
  end if;
  begin
    return nullif(btrim(current_setting('request.headers', true)::jsonb ->> header), '');
  exception when others then
    -- No request, or headers that are not JSON: there is no header to read.
    return null;
  end;
end;
$$;

revoke all on function goals.request_value(text, text) from public, anon, authenticated;

create or replace function goals.record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb;
  new_row jsonb;
  old_diff jsonb := '{}'::jsonb;
  new_diff jsonb := '{}'::jsonb;
  key text;
  owner uuid;
  row_id uuid;
  act text;
  who text;
  claims_role text;
  capture text;
  run text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    old_row := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new_row := to_jsonb(new);
  end if;

  owner := coalesce(new_row, old_row) ->> 'user_id';
  row_id := coalesce(new_row, old_row) ->> 'id';

  if tg_op = 'INSERT' then
    act := 'insert';
    old_diff := null;
    new_diff := new_row;
  elsif tg_op = 'DELETE' then
    -- A delete that is the account going away is not recorded: the history
    -- is going with it, and a row written now would point at a user who is
    -- already gone.
    if not exists (select 1 from auth.users u where u.id = owner) then
      return old;
    end if;
    act := 'delete';
    old_diff := old_row;
    new_diff := null;
  else
    for key in select jsonb_object_keys(new_row) loop
      if key <> 'updated_at' and (old_row -> key) is distinct from (new_row -> key) then
        old_diff := old_diff || jsonb_build_object(key, old_row -> key);
        new_diff := new_diff || jsonb_build_object(key, new_row -> key);
      end if;
    end loop;
    -- An update that changed nothing but the timestamp is not a change.
    if new_diff = '{}'::jsonb then
      return new;
    end if;
    if (old_row ->> 'archived_at') is null and (new_row ->> 'archived_at') is not null then
      act := 'archive';
    elsif (old_row ->> 'archived_at') is not null and (new_row ->> 'archived_at') is null then
      act := 'unarchive';
    else
      act := 'update';
    end if;
  end if;

  who := goals.request_value('goals.actor', 'x-goals-actor');
  if who is null or who not in ('me', 'claude', 'capture') then
    claims_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
    who := case when claims_role = 'authenticated' then 'me' else 'claude' end;
  end if;

  capture := goals.request_value('goals.capture_id', 'x-goals-capture');
  if capture !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    capture := null;
  end if;
  run := goals.request_value('goals.run_id', 'x-goals-run');
  if run !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    run := null;
  end if;

  insert into goals.history
    (user_id, table_name, row_id, action, old_values, new_values, actor, capture_id, run_id)
  values
    (owner, tg_table_name, row_id, act, old_diff, new_diff, who, capture::uuid, run::uuid);

  return coalesce(new, old);
end;
$$;

revoke all on function goals.record_history() from public, anon, authenticated;

create trigger areas_history after insert or update or delete on goals.areas
  for each row execute function goals.record_history();
create trigger items_history after insert or update or delete on goals.items
  for each row execute function goals.record_history();
create trigger runs_history after insert or update or delete on goals.runs
  for each row execute function goals.record_history();
create trigger captures_history after insert or update or delete on goals.captures
  for each row execute function goals.record_history();
create trigger readings_history after insert or update or delete on goals.readings
  for each row execute function goals.record_history();
create trigger periods_history after insert or update or delete on goals.periods
  for each row execute function goals.record_history();
create trigger suggestions_history after insert or update or delete on goals.suggestions
  for each row execute function goals.record_history();

-- ---------------------------------------------------------------------------
-- Row level security, on every table. auth.uid() is wrapped in a select so it
-- is evaluated once per query rather than once per row.
-- ---------------------------------------------------------------------------
alter table goals.areas enable row level security;
alter table goals.items enable row level security;
alter table goals.runs enable row level security;
alter table goals.captures enable row level security;
alter table goals.readings enable row level security;
alter table goals.periods enable row level security;
alter table goals.suggestions enable row level security;
alter table goals.history enable row level security;

create policy areas_all on goals.areas for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy items_all on goals.items for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy runs_all on goals.runs for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy captures_all on goals.captures for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy readings_all on goals.readings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy periods_all on goals.periods for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy suggestions_all on goals.suggestions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Read only. Nothing but the trigger writes history.
create policy history_select on goals.history for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on all tables in schema goals from anon, public;

grant usage on schema goals to authenticated, service_role;
grant select, insert, update, delete
  on goals.areas, goals.items, goals.runs, goals.captures, goals.readings,
     goals.periods, goals.suggestions
  to authenticated, service_role;
grant select on goals.history to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Expose `goals` to PostgREST, the way migrations-news/0002 exposed `news`:
-- read the configured list, add `goals` if it is missing, leave the rest.
-- ---------------------------------------------------------------------------
do $$
declare
  current_schemas text;
  wanted text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    -- The local test database has no PostgREST in front of it.
    raise notice 'no authenticator role; skipping PostgREST schema exposure';
    return;
  end if;

  select split_part(config, '=', 2)
    into current_schemas
    from pg_db_role_setting,
         lateral unnest(setconfig) as config
   where setrole = 'authenticator'::regrole
     and setdatabase = 0
     and config like 'pgrst.db_schemas=%';

  if current_schemas is null then
    current_schemas := 'public, graphql_public, core, job_search, obsidian, todo, learn, news';
  end if;

  if exists (
    select 1
      from unnest(string_to_array(current_schemas, ',')) as s
     where btrim(s) = 'goals'
  ) then
    raise notice 'goals is already exposed (%)', current_schemas;
    return;
  end if;

  wanted := current_schemas || ', goals';
  execute format('alter role authenticator set pgrst.db_schemas = %L', wanted);
  raise notice 'exposed schemas are now %', wanted;
end
$$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';

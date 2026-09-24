-- ===========================================================================
-- goals.links -- a goal or step pointing at something another module owns
-- (plan #931).
--
-- docs/GOALS-SPEC.md, "Where things live": a learning goal stays a row of
-- learn.aims and the job search stays in job_search. A goal holds them by
-- reference and reads their progress when its page loads. Nothing is copied
-- out of those modules and nothing here writes to them.
--
-- A link is one of four kinds:
--
--   aim          a Learn aim (learn.aims), by id.
--   job_search   the whole job search. No target: the counts are read across
--                every application and interview.
--   role         one role (job_search.roles), by id.
--   application  one application (job_search.applications), by id.
--
-- There is no foreign key to the other schemas: those rows are owned and
-- removed by their own modules, and a goal's link should not stop Learn from
-- deleting an aim. The check trigger below makes sure the target is the
-- account's own when the link is made; a link whose target has since gone is
-- read as gone rather than as an error.
--
-- Nothing is deleted. Unlinking sets archived_at; linking the same target
-- again brings that row back, so one item and one target have one row.
-- ===========================================================================

create table goals.links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  item_id uuid not null,
  kind text not null,
  target_id uuid,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint links_id_user_key unique (id, user_id),
  -- The job search has no target, so nulls must count as equal here or the
  -- same goal could hold it twice.
  constraint links_target_key unique nulls not distinct (item_id, kind, target_id),

  constraint links_item_fk foreign key (item_id, user_id)
    references goals.items (id, user_id),
  constraint links_kind_ck check (kind in ('aim', 'job_search', 'role', 'application')),
  constraint links_target_ck check ((kind = 'job_search') = (target_id is null))
);

create index links_item_idx on goals.links (item_id) where archived_at is null;

-- The target has to exist and be the account's own. Checked when a link is
-- made or brought back, not when it is archived: an aim archived in Learn can
-- still be unlinked here. Runs as the caller, so under row level security a
-- signed-in person cannot see another account's rows at all; the user_id test
-- covers a routine writing with the service role.
create or replace function goals.links_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  found boolean;
begin
  if new.archived_at is not null then
    return new;
  end if;

  if new.kind = 'aim' then
    select exists (
      select 1 from learn.aims a
      where a.id = new.target_id and a.user_id = new.user_id and a.archived_at is null
    ) into found;
  elsif new.kind = 'role' then
    select exists (
      select 1 from job_search.roles r
      where r.id = new.target_id and r.user_id = new.user_id
    ) into found;
  elsif new.kind = 'application' then
    select exists (
      select 1 from job_search.applications a
      where a.id = new.target_id and a.user_id = new.user_id
    ) into found;
  else
    found := true;
  end if;

  if not found then
    raise exception 'links: no % % of yours to link', new.kind, new.target_id
      using errcode = 'check_violation', constraint = 'links_target_exists';
  end if;

  return new;
end;
$$;

revoke all on function goals.links_check() from public, anon, authenticated;

create trigger links_check before insert or update of kind, target_id, archived_at on goals.links
  for each row execute function goals.links_check();

create trigger links_touch_updated_at before update on goals.links
  for each row execute function goals.touch_updated_at();

-- History, like every other table in the schema.
alter table goals.history drop constraint history_table_ck;
alter table goals.history add constraint history_table_ck check (
  table_name in (
    'areas', 'items', 'item_goals', 'links', 'runs', 'captures', 'readings', 'periods',
    'suggestions'
  )
);

create trigger links_history after insert or update or delete on goals.links
  for each row execute function goals.record_history();

alter table goals.links enable row level security;

create policy links_all on goals.links for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on goals.links from anon, public;
grant select, insert, update, delete on goals.links to authenticated, service_role;

notify pgrst, 'reload schema';

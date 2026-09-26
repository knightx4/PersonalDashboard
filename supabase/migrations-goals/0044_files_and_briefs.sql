-- ===========================================================================
-- Files on goals, and the note at the top of each goal and of the home.
--
-- 1. goals.links takes a fifth kind, 'file': a goal or step pointing at a
--    file in core.files (migrations/0105). A step Claude worked links the
--    file it wrote; a goal links the files that bear on it. Like the other
--    kinds there is no foreign key into another schema, and the check
--    trigger makes sure the file is the account's own and not archived.
--
-- 2. goals.briefs: Claude's note on where things stand, in a few lines of
--    markdown. With item_id on a goal it heads that goal's page. With no
--    item_id it heads the Goals home and covers every goal at once. Runs
--    write one as they finish; the page shows the newest for each place.
--    Rows are never updated, so the older ones are the record of how things
--    were read over time, as with goals.reviews.
--
--    The routine writes them through the connector. The app only reads, so
--    the signed-in role gets select and nothing else.
-- ===========================================================================

alter table goals.links drop constraint links_kind_ck;
alter table goals.links add constraint links_kind_ck
  check (kind in ('aim', 'job_search', 'role', 'application', 'file'));

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
  elsif new.kind = 'file' then
    select exists (
      select 1 from core.files f
      where f.id = new.target_id and f.user_id = new.user_id and f.archived_at is null
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

-- Every file linked to any item, for the file's own page: "linked to".
create index links_file_idx on goals.links (target_id) where kind = 'file' and archived_at is null;

create table goals.briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- The goal it heads; null for the Goals home.
  item_id uuid,
  run_id uuid,

  body text not null,

  created_at timestamptz not null default now(),

  constraint briefs_item_fk foreign key (item_id, user_id)
    references goals.items (id, user_id) on delete cascade,
  constraint briefs_run_fk foreign key (run_id, user_id)
    references goals.runs (id, user_id) on delete set null (run_id),

  constraint briefs_body_ck check (btrim(body) <> '' and length(body) <= 2000)
);

-- Each page reads the newest row for its place.
create index briefs_item_created_idx on goals.briefs (user_id, item_id, created_at desc);
create index briefs_run_idx on goals.briefs (run_id) where run_id is not null;

alter table goals.briefs enable row level security;

create policy briefs_select on goals.briefs for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on goals.briefs from anon, public;
grant select on goals.briefs to authenticated;
grant select, insert on goals.briefs to service_role;

comment on table goals.briefs is
  'Claude''s note on where things stand: on one goal (item_id) or across all of them (item_id null). Written as a run finishes; the page shows the newest.';

notify pgrst, 'reload schema';

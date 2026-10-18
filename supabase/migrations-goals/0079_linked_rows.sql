-- ===========================================================================
-- goals.links takes readings, events, saved products and contacts, and a
-- list name (plan #2330.1, feature #2330).
--
-- A goal's list of things another workspace already holds points at those
-- rows instead of copying them, so finishing a reading in Learn shows on the
-- goal too (the person chose linked rows over copies on 17 October 2026).
-- Four new kinds:
--
--   reading     a reading on a Learn track (learn.readings), by id.
--   event       a calendar event (todo.events), by id.
--   saved_item  a product saved for later in Shopping (public.saved_items).
--   contact     a contact in the job search (job_search.contacts).
--
-- list_name groups a goal's links into its lists: every link of one item with
-- the same list name is one list ("Reading", "Events"). Null means the kind's
-- own list, named in lib/goals/links.ts (DEFAULT_LIST_NAMES), so a link made
-- without a name still lands somewhere.
--
-- links_check gains a branch per kind: the target has to exist and be the
-- account's own, as for the kinds before. None of the four tables archives
-- its rows, so a target removed since is read as gone, as 0005 says.
-- ===========================================================================

alter table goals.links drop constraint links_kind_ck;
alter table goals.links add constraint links_kind_ck check (
  kind in ('aim', 'job_search', 'role', 'application', 'file', 'reading', 'event', 'saved_item', 'contact')
);

alter table goals.links add column list_name text;
alter table goals.links add constraint links_list_name_ck check (
  list_name is null or (btrim(list_name) <> '' and length(list_name) <= 80)
);

comment on column goals.links.list_name is
  'The list on the goal this link belongs to; links of one item with the same '
  'name are one list. Null is the kind''s own list (lib/goals/links.ts).';

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
  elsif new.kind = 'reading' then
    select exists (
      select 1 from learn.readings r
      where r.id = new.target_id and r.user_id = new.user_id
    ) into found;
  elsif new.kind = 'event' then
    select exists (
      select 1 from todo.events e
      where e.id = new.target_id and e.user_id = new.user_id
    ) into found;
  elsif new.kind = 'saved_item' then
    select exists (
      select 1 from public.saved_items s
      where s.id = new.target_id and s.user_id = new.user_id
    ) into found;
  elsif new.kind = 'contact' then
    select exists (
      select 1 from job_search.contacts c
      where c.id = new.target_id and c.user_id = new.user_id
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

-- Which goals hold a reading, an event, a product or a contact, for the
-- workspace that owns it to say so.
create index links_target_idx on goals.links (kind, target_id)
  where archived_at is null and target_id is not null;

notify pgrst, 'reload schema';

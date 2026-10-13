-- Whether a file has been read (plan #1860).
--
-- A file Dash writes for a goal step is something to read, and the goal page
-- and the Goals home will mark the ones not read yet (plan #1861). Until now
-- the only record of reading was on the step (goals.items.reviewed_at), which
-- says nothing once a later run revises the file the step made.
--
-- `read_at` is when the person last opened the file. A new version, a change
-- to the title or body, clears it: what they read is kept in
-- core.file_versions, and what is there now has not been read.
--
-- Marking a file read must not move it in the list, which is ordered by
-- updated_at. So an update that changes nothing but read_at keeps
-- updated_at as it was; any other edit still moves it, as before.

set search_path = core, public, extensions;

alter table core.files add column read_at timestamptz;

comment on column core.files.read_at is
  'When the person last opened the file. Null until then, and cleared by each new version of the title or body.';

-- The unread count, per account.
create index files_unread_idx on core.files (user_id)
  where read_at is null and archived_at is null;

create or replace function core.files_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    return new;
  end if;
  if new.title is distinct from old.title or new.body is distinct from old.body then
    new.version := old.version + 1;
    new.updated_at := now();
    new.read_at := null;
    if new.change_note is not distinct from old.change_note then
      new.change_note := null;
    end if;
  else
    new.version := old.version;
    -- Reading it is not a change to it.
    if (to_jsonb(new) - 'read_at' - 'updated_at') = (to_jsonb(old) - 'read_at' - 'updated_at') then
      new.updated_at := old.updated_at;
    else
      new.updated_at := now();
    end if;
  end if;
  return new;
end;
$$;

revoke all on function core.files_version() from public, anon, authenticated;

notify pgrst, 'reload schema';

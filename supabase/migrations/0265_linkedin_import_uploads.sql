-- Uploading a LinkedIn export from the Jobs settings page (plan #2432.9).
--
-- 1. core.import_runs.skipped_files: the files of the export the import did
--    not read, or read with rows it could not use, as a jsonb array of
--    { path, reason }, so the run history can say what was left out and why.
--
-- 2. The imports bucket: the uploaded export zips, private, one folder per
--    account. The browser puts the zip straight into the person's folder,
--    so a file of tens of megabytes never passes through a server action's
--    body; the action reads it back from there to plan and apply it. A
--    LinkedIn export is a few megabytes, and the full archive with every
--    message can pass fifty, so the limit is 200 MB.
--
-- Schema only: no rows are changed.

alter table core.import_runs
  add column skipped_files jsonb not null default '[]'::jsonb;

alter table core.import_runs
  add constraint import_runs_skipped_files_ck check (jsonb_typeof(skipped_files) = 'array');

comment on column core.import_runs.skipped_files is
  'The files of the export the import left out or read only in part, as [{ path, reason }] (plan #2432.9).';

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'no storage schema here -- skipping the imports bucket. Expected on the local test database.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'imports',
    'imports',
    false,
    209715200,
    array['application/zip', 'application/x-zip-compressed']
  )
  on conflict (id) do nothing;

  execute $p$
    create policy imports_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'imports'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;

  execute $p$
    create policy imports_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'imports'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;

  execute $p$
    create policy imports_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'imports'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;
end;
$$;

notify pgrst, 'reload schema';

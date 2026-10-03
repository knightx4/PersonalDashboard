-- ===========================================================================
-- Resume PDFs: a resume version keeps the file itself, not only its text.
--
-- resume_versions.storage_path has been in the schema since 0002 and nothing
-- wrote it, because the job-search bucket had no policies and so nobody but
-- the service role could put a file in it. These give a signed-in person
-- their own folder there:
--
--   path       <your user id>/resumes/<a fresh uuid>.pdf
--   read       your own folder only
--   write      your own folder only, and never over an existing file
--   delete     your own folder only
--
-- The browser uploads the file on your session, which keeps it out of the
-- server action's request body (capped at one megabyte). Nothing is served
-- from the bucket directly: the settings page links to /jobs/resume/<id>,
-- which signs a short-lived URL for the file.
--
-- Account deletion already removes every resume_versions.storage_path from
-- this bucket (app/api/account/delete/route.ts).
--
-- Skipped where there is no storage schema, which is the local test database,
-- as for the goals-documents bucket (goals 0011).
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'no storage schema here -- skipping the job-search bucket policies. Expected on the local test database.';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('job-search', 'job-search', false)
  on conflict (id) do nothing;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and policyname = 'job_search_files_select'
  ) then
    return;
  end if;

  execute $p$
    create policy job_search_files_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'job-search'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;

  execute $p$
    create policy job_search_files_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'job-search'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;

  execute $p$
    create policy job_search_files_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'job-search'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;
end;
$$;

-- ===========================================================================
-- Documents behind a form: the private bucket that keeps a statement PDF,
-- screenshot or Word file you filled a form from (plan #955).
--
-- docs/GOALS-SPEC.md, "Four ways to fill a form", the second way. You drop a
-- file on an information step, the app reads it against the collection's
-- definition and shows the form filled in, and the records you confirm point
-- at the file with source 'document' and source_ref set to its path here.
--
-- The browser uploads the file itself, on your session, and the server reads
-- it back on the same session. That keeps the file out of the server action's
-- request body, which is capped at one megabyte, and it means the bucket's
-- policies are the only thing deciding who can reach a file:
--
--   path       <your user id>/<a fresh uuid>-<the file's name>
--   read       your own folder only
--   write      your own folder only, and never over an existing file
--   delete     your own folder only
--
-- Nothing is served from the bucket directly. The goal page links a record to
-- /goals/document, which signs a short-lived URL for a file in your folder.
--
-- Skipped where there is no storage schema, which is the local test database,
-- as for the learn-transcripts bucket (learn 0042).
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'no storage schema here -- skipping the goals-documents bucket. Expected on the local test database.';
    return;
  end if;

  -- 20 MB: a scanned statement runs to a few megabytes, and the model reads
  -- a PDF of up to 32 MB. The types are the ones the form can read.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'goals-documents',
    'goals-documents',
    false,
    20971520,
    array[
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/csv',
      'text/html'
    ]
  )
  on conflict (id) do nothing;

  execute $p$
    create policy goals_documents_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'goals-documents'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;

  execute $p$
    create policy goals_documents_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'goals-documents'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;

  execute $p$
    create policy goals_documents_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'goals-documents'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;
end;
$$;

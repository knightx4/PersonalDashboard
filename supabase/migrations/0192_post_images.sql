-- Images the person uploads to an X post on the Posts tab in Dev.
--
-- Until now a draft's picture could only be a Surfaces-gallery screenshot a
-- posts run committed under public/posts/. A post the person writes, or a
-- draft they want a different picture on, needs one they choose, so this is a
-- private bucket with one folder per account, the same shape as the goals
-- documents bucket (goals migration 0011).
--
-- social_posts.image_paths keeps both kinds side by side: a site path
-- ("/posts/…png") for a committed screenshot, and a path in this bucket
-- ("<user id>/<uuid>-<name>") for an upload, which the page signs on the way
-- out (app/dev/posts/image/route.ts). No column changes.
--
-- 10 MB and the four image types X takes in a post.

set search_path = public, extensions;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'no storage schema here -- skipping the post-images bucket. Expected on the local test database.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'post-images',
    'post-images',
    false,
    10485760,
    array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
  )
  on conflict (id) do nothing;

  execute $p$
    create policy post_images_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'post-images'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;

  execute $p$
    create policy post_images_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'post-images'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;

  execute $p$
    create policy post_images_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'post-images'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;
end
$$;

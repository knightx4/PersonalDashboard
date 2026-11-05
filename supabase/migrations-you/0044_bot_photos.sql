-- A picture of the person's own for each bot (plan #2955).
--
-- Chat draws every bot as a round mark with its initials in its colour. The
-- person can now upload an image to stand in that mark instead, on the bot's
-- form on Chat's Bots tab, and take it off again.
--
-- 1. you.board_advisors.photo_path
--
-- Where the bot's picture is kept in the you-bot-photos bucket, or null for
-- none, when the initials are drawn as before. The path sits in the owner's
-- folder under the bot's own id, so a row can only point at a picture filed
-- for it:
--
--   <user id>/<advisor id>/<a fresh uuid>.<png|jpg|webp|gif>
--
-- A fresh name for every upload means a changed picture is never served from
-- a cache under the old one. The old object is removed by the app when the
-- column moves off it (lib/you/bot-photos.ts), and when the bot is deleted.
--
-- 2. The you-bot-photos bucket
--
-- Written the way 0008 writes you-course-files: private, read and written in
-- your own folder only, never over an existing file. 5 MB per picture, and
-- the four image types a browser draws everywhere. The pages read it through
-- signed links made on the server.
--
-- The folder test is you.bot_photo_is_own, so the local test database, which
-- has no storage schema, can check the rule the bucket policies apply. The
-- bucket half is skipped where there is no storage schema.
--
-- Schema change only. No row of any account is written.

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The column.
-- ---------------------------------------------------------------------------

alter table you.board_advisors
  add column photo_path text;

alter table you.board_advisors
  add constraint board_advisors_photo_path_ck check (
    photo_path is null or (
      char_length(photo_path) <= 300
      and photo_path like user_id::text || '/' || id::text || '/_%'
    )
  );

comment on column you.board_advisors.photo_path is
  'The picture the person uploaded for this bot, as its path in the you-bot-photos bucket (<user id>/<advisor id>/<file>); null draws their initials in their colour (plan #2955).';

-- ---------------------------------------------------------------------------
-- 2. The bucket.
-- ---------------------------------------------------------------------------

-- Whether a storage object's name sits in the caller's own folder, under a
-- bot's folder, with a file name after it.
create or replace function you.bot_photo_is_own(object_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select object_name is not null
    and split_part(object_name, '/', 1) = (select auth.uid())::text
    and split_part(object_name, '/', 2) <> ''
    and split_part(object_name, '/', 3) <> ''
    and split_part(object_name, '/', 4) = '';
$$;

revoke all on function you.bot_photo_is_own(text) from public, anon;
grant execute on function you.bot_photo_is_own(text) to authenticated, service_role;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'no storage schema here -- skipping the you-bot-photos bucket. Expected on the local test database.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'you-bot-photos',
    'you-bot-photos',
    false,
    5242880,
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
  )
  on conflict (id) do nothing;

  execute $p$
    create policy you_bot_photos_select on storage.objects
      for select to authenticated
      using (bucket_id = 'you-bot-photos' and you.bot_photo_is_own(name))
  $p$;

  execute $p$
    create policy you_bot_photos_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'you-bot-photos' and you.bot_photo_is_own(name))
  $p$;

  execute $p$
    create policy you_bot_photos_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'you-bot-photos' and you.bot_photo_is_own(name))
  $p$;
end;
$$;

notify pgrst, 'reload schema';

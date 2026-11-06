-- A picture of a screen kept with a question (plan #2810.1).
--
-- A question about a screen is easier to answer with the screen in front of
-- you. Each row is one picture of one option, or of the whole question when
-- `option_letter` is null, at one of two widths: 390 for a phone, 1280 for a
-- laptop. `storage_path` is the file in the private plan-mockups bucket,
-- `link` is where the interactive mockup opens, and `html_path` is the
-- mockup's own HTML file in the repository, so a later session can redraw it.
--
-- The bucket, plan-mockups, is private. Its files sit at
--   <user id>/<plan item number>/<file>.png
-- and an account reads its own folder and nothing else. Only the service
-- role writes, from scripts/plan.ts; no signed-in session uploads or deletes
-- here. Skipped where there is no storage schema, which is the local test
-- database, as for the ui-shots bucket (0173).

set search_path = public, extensions;

create table if not exists plan_item_mockups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references plan_items (id) on delete cascade,
  option_letter text,
  width integer not null,
  storage_path text not null,
  link text,
  html_path text,
  created_at timestamptz not null default now(),
  constraint plan_item_mockups_letter_ck check (option_letter is null or option_letter ~ '^[A-Z]$'),
  constraint plan_item_mockups_width_ck check (width in (390, 1280)),
  constraint plan_item_mockups_path_ck check (length(btrim(storage_path)) > 0 and length(storage_path) <= 300),
  constraint plan_item_mockups_link_ck check (link is null or length(link) <= 500),
  constraint plan_item_mockups_html_ck check (html_path is null or length(html_path) <= 300)
);

-- One picture per option and width. A null letter is the whole question, and
-- null never equals null in a plain unique index, so it is coalesced.
create unique index if not exists plan_item_mockups_slot_key
  on plan_item_mockups (item_id, coalesce(option_letter, ''), width);
create index if not exists plan_item_mockups_user_idx on plan_item_mockups (user_id);

alter table plan_item_mockups enable row level security;

create policy plan_item_mockups_select on plan_item_mockups for select to authenticated
  using (user_id = (select auth.uid()));
create policy plan_item_mockups_insert on plan_item_mockups for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy plan_item_mockups_update on plan_item_mockups for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy plan_item_mockups_delete on plan_item_mockups for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on plan_item_mockups to authenticated;
revoke all on table plan_item_mockups from anon;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'no storage schema here -- skipping the plan-mockups bucket. Expected on the local test database.';
    return;
  end if;

  -- 5 MB: a laptop picture of a long page runs to about one.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('plan-mockups', 'plan-mockups', false, 5242880, array['image/png'])
  on conflict (id) do nothing;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'plan_mockups_select'
  ) then
    execute $p$
      create policy plan_mockups_select on storage.objects
        for select to authenticated
        using (
          bucket_id = 'plan-mockups'
          and (storage.foldername(name))[1] = (select auth.uid())::text
        )
    $p$;
  end if;
end;
$$;

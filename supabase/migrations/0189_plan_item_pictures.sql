-- Pictures on a plan row: drawn options for a proposal or a decision.
--
-- A shaped feature or a decision about how something should look was words
-- only, so the person approved a look they had not seen. This keeps drawings
-- a session made against the row they belong to, shown when the row is opened
-- on /dev/plan.
--
-- A picture is an SVG kept as text in the row, not a file in a bucket. An SVG
-- can carry its own animation, which a mockup of something that moves needs,
-- and as text it can be written through the Supabase connector, which cannot
-- upload to storage. 300,000 characters is far past any hand-drawn mockup.
-- The page never puts it into its own markup: it loads through
-- /dev/plan/picture as an image, where an SVG cannot run a script, and that
-- route sends it with a policy that refuses one too.
--
-- `position` orders the pictures under a row; `caption` says which option it
-- is, such as "A: four hats".

set search_path = public, extensions;

create table if not exists plan_item_pictures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references plan_items (id) on delete cascade,
  caption text not null,
  svg text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint plan_item_pictures_caption_ck
    check (length(btrim(caption)) > 0 and length(caption) <= 200),
  constraint plan_item_pictures_svg_ck
    check (length(svg) <= 300000 and svg ~ '^\s*(<\?xml[^>]*>\s*)?<svg[\s>]')
);

create index if not exists plan_item_pictures_item_idx
  on plan_item_pictures (item_id, position);
create index if not exists plan_item_pictures_user_idx
  on plan_item_pictures (user_id);

alter table plan_item_pictures enable row level security;

create policy plan_item_pictures_select on plan_item_pictures for select to authenticated
  using (user_id = (select auth.uid()));
-- A picture can only be put on a row of your own.
create policy plan_item_pictures_insert on plan_item_pictures for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from plan_items p where p.id = item_id and p.user_id = (select auth.uid())
    )
  );
create policy plan_item_pictures_update on plan_item_pictures for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy plan_item_pictures_delete on plan_item_pictures for delete to authenticated
  using (user_id = (select auth.uid()));

-- Said out loud for the reasons 0050 gives.
grant select, insert, update, delete on plan_item_pictures to authenticated;
revoke all on table plan_item_pictures from anon;

notify pgrst, 'reload schema';

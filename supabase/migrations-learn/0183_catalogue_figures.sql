-- Figures stored with a course (plan #2321.4).
--
-- learn.catalogue_figures
--     The images found on the pages fetched for a structure document (an MIT
--     OpenCourseWare course page), one row per image, with the alt text the
--     page gives it, the page it was found on, and the licence it is shown
--     under. item_id is the structure document's catalogue item, so the
--     licence mode that decides whether the image may be shown is the one on
--     that document's catalogue_structures row: only 'show' ever draws one
--     (lib/learn/catalogue/figures.ts).
--
-- Shared like the rest of the catalogue: no user_id, readable by any
-- signed-in account, written only by the service role. No row is rewritten
-- here; the daily pull fills the table.

set search_path = learn, public, extensions;

create table if not exists learn.catalogue_figures (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references learn.catalogue_items (id) on delete cascade,
  image_url text not null,
  alt_text text not null,
  -- The page the image was found on, which the figure links to.
  page_url text not null,
  -- As the course states it: "CC BY-NC-SA 4.0".
  licence text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),

  constraint catalogue_figures_image_url_ck check (image_url ~ '^https://'),
  constraint catalogue_figures_page_url_ck check (page_url ~ '^https://'),
  constraint catalogue_figures_alt_text_ck check (btrim(alt_text) <> ''),
  constraint catalogue_figures_licence_ck check (btrim(licence) <> ''),
  constraint catalogue_figures_item_image_uq unique (item_id, image_url)
);

create index if not exists catalogue_figures_item_idx on learn.catalogue_figures (item_id, position);

alter table learn.catalogue_figures enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'learn' and tablename = 'catalogue_figures'
       and policyname = 'catalogue_figures_select'
  ) then
    create policy catalogue_figures_select on learn.catalogue_figures
      for select to authenticated using (true);
  end if;
end;
$$;

grant select on learn.catalogue_figures to authenticated;
grant all on learn.catalogue_figures to service_role;
revoke all on table learn.catalogue_figures from anon;

comment on table learn.catalogue_figures is
  'Images found on the pages fetched for a structure document, with alt text, source page and licence. Shown on a lesson only when the document''s licence mode is show (plan #2321.4).';

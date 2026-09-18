-- Somewhere to hang a comment on a specification.
--
-- The specs live in `docs/` and the repository is their only source of truth --
-- same reasoning as the plan seed, and for a stronger reason here: a document
-- arguing for a design is written in the same commit as the design, reviewed in
-- the same diff, and would be a different document if the app could rewrite it.
-- Nothing in this migration stores a word of one.
--
-- What it stores is a row per section, so a comment has something to attach to.
-- A comment on a 650-line document is a comment on nothing; a comment on
-- "What an edge is" is a comment on a decision. The section is identified by
-- the slug of its heading, which is stable while the heading is and breaks when
-- the heading is rewritten -- at which point the row is kept and shown as
-- belonging to a section that no longer exists, because a comment is worth more
-- than the heading it was filed under.
--
-- `dev_comments` gains its fifth nullable target, for the reasons 0064 and 0066
-- give: the cascade is what stops a deleted section leaving its thread behind,
-- and `num_nonnulls` = 1 is what says a comment is about exactly one thing.
-- That also means a spec comment reaches Dash and the conversations list by the
-- same path as every other comment, with no second mechanism.

set search_path = public, extensions;

create table if not exists spec_sections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Which document, as its file's slug: 'learn-map', 'learn-graph'.
  slug text not null,
  -- The section's heading, slugified. Unique within a document.
  anchor text not null,
  -- The heading as written, so a thread reads correctly even after the
  -- document has moved on and the section is gone.
  heading text not null,
  -- Order within the document, so threads list in reading order.
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint spec_sections_slug_anchor_key unique (user_id, slug, anchor),
  constraint spec_sections_slug_not_blank_ck check (length(btrim(slug)) > 0),
  constraint spec_sections_anchor_not_blank_ck check (length(btrim(anchor)) > 0),
  constraint spec_sections_heading_length_ck check (length(heading) <= 300)
);

create index if not exists spec_sections_user_slug_idx
  on spec_sections (user_id, slug, position);

alter table spec_sections enable row level security;

drop policy if exists spec_sections_select on spec_sections;
create policy spec_sections_select on spec_sections for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists spec_sections_insert on spec_sections;
create policy spec_sections_insert on spec_sections for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists spec_sections_update on spec_sections;
create policy spec_sections_update on spec_sections for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists spec_sections_delete on spec_sections;
create policy spec_sections_delete on spec_sections for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on spec_sections to authenticated;
revoke all on table spec_sections from anon;

-- ------------------------------------------------------------ the fifth target

alter table dev_comments
  add column if not exists spec_section_id uuid references spec_sections (id) on delete cascade;

alter table dev_comments drop constraint if exists dev_comments_one_target_ck;
alter table dev_comments add constraint dev_comments_one_target_ck
  check (
    num_nonnulls(idea_id, plan_item_id, raised_item_id, feedback_item_id, spec_section_id) = 1
  );

create index if not exists dev_comments_spec_section_idx
  on dev_comments (spec_section_id, created_at) where spec_section_id is not null;

-- Rewritten whole rather than added to, as 0066 had to be: a policy is
-- replaced, not extended, and the other four branches have to survive it.
drop policy if exists dev_comments_insert on dev_comments;
create policy dev_comments_insert on dev_comments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      exists (
        select 1 from raised_items r
        where r.id = raised_item_id and r.user_id = (select auth.uid())
      )
      or exists (
        select 1 from ideas i
        where i.id = idea_id and i.user_id = (select auth.uid())
      )
      or exists (
        select 1 from plan_items p
        where p.id = plan_item_id and p.user_id = (select auth.uid())
      )
      or exists (
        select 1 from feedback_items f
        where f.id = feedback_item_id and f.user_id = (select auth.uid())
      )
      or exists (
        select 1 from spec_sections s
        where s.id = spec_section_id and s.user_id = (select auth.uid())
      )
    )
  );

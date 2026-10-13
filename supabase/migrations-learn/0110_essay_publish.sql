-- Publishing an essay for selveyknight.com to read (plan #1863.11; spec
-- docs/LEARN-ESSAYS-SPEC.md, "Finishing and publishing", rule R4).
--
-- Publish copies the essay into a snapshot on its row: the body with the
-- authorship block removed, footnotes kept and wikilinks to anything but
-- another published essay turned into plain text (lib/learn/essays/publish.ts
-- builds it), and the frontmatter the site shows, as it stood at that press.
-- Later edits stay private until the person publishes again. Unpublish clears
-- the snapshot and keeps first_published_at, so publishing again keeps the
-- date the essay first went out.
--
-- The site reads the snapshot through two functions open to the anonymous
-- key, the same posture as job_search.public_case_page and public.share_page:
-- no anon policy on learn.essays, no view, no service key. Each function is
-- the whole decision about what an anonymous caller sees, and it is all here:
--
--   * only the owner's essays (public.owner_email(), migration 0085), since
--     selveyknight.com is the owner's site and two other accounts sign in;
--   * only rows with a snapshot, a slug and a published stage, so a draft
--     cannot come back however its row is edited;
--   * only the snapshot columns: never draft_body, the brief, the authorship
--     ranges, the note's path or the user id.
--
-- Both are `stable`, so neither can write. They sit in `public` because anon
-- has no usage on the learn schema and should not be given it: the site
-- calls them as rpc('published_essays') and rpc('published_essay', { p_slug }).

set search_path = learn, public, extensions;

alter table learn.essays
  add column if not exists published_title text,
  add column if not exists published_description text,
  add column if not exists published_stage text,
  add column if not exists published_confidence text,
  add column if not exists published_tags text[] not null default '{}',
  add column if not exists first_published_at timestamptz;

comment on column learn.essays.published_title is
  'The title as last published (plan #1863.11); null while unpublished.';
comment on column learn.essays.published_description is
  'The frontmatter description as last published; null while unpublished.';
comment on column learn.essays.published_stage is
  'The frontmatter stage as last published: seedling, budding or evergreen.';
comment on column learn.essays.published_confidence is
  'The frontmatter confidence as last published, or null for none.';
comment on column learn.essays.published_tags is
  'The frontmatter tags as last published.';
comment on column learn.essays.first_published_at is
  'When the essay was first published. Kept through Unpublish, so publishing again keeps the date.';

-- Every published essay of the owner's, newest first, without the body.
create or replace function public.published_essays()
returns table (
  slug text,
  title text,
  description text,
  stage text,
  confidence text,
  tags text[],
  published_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.slug,
         e.published_title,
         coalesce(e.published_description, ''),
         e.published_stage,
         e.published_confidence,
         e.published_tags,
         coalesce(e.first_published_at, e.published_at),
         e.published_at
    from learn.essays e
   where e.user_id = (select u.id from auth.users u where lower(u.email) = public.owner_email() limit 1)
     and e.published_body is not null
     and e.published_at is not null
     and e.slug is not null
     and e.published_stage in ('seedling', 'budding', 'evergreen')
   order by coalesce(e.first_published_at, e.published_at) desc, e.slug;
$$;

comment on function public.published_essays() is
  'The owner''s published essays for selveyknight.com, newest first, without bodies (plan #1863.11). Open to anon.';

-- One published essay of the owner's by its slug, with the snapshot body.
create or replace function public.published_essay(p_slug text)
returns table (
  slug text,
  title text,
  description text,
  stage text,
  confidence text,
  tags text[],
  published_at timestamptz,
  updated_at timestamptz,
  body text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.slug,
         e.published_title,
         coalesce(e.published_description, ''),
         e.published_stage,
         e.published_confidence,
         e.published_tags,
         coalesce(e.first_published_at, e.published_at),
         e.published_at,
         e.published_body
    from learn.essays e
   where p_slug is not null
     and e.slug = p_slug
     and e.user_id = (select u.id from auth.users u where lower(u.email) = public.owner_email() limit 1)
     and e.published_body is not null
     and e.published_at is not null
     and e.published_stage in ('seedling', 'budding', 'evergreen')
   limit 1;
$$;

comment on function public.published_essay(text) is
  'One of the owner''s published essays by slug, with its snapshot body (plan #1863.11). Open to anon.';

revoke all on function public.published_essays() from public;
revoke all on function public.published_essay(text) from public;
grant execute on function public.published_essays() to anon, authenticated;
grant execute on function public.published_essay(text) to anon, authenticated;

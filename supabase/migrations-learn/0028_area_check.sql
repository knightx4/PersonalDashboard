-- The check that the areas are exclusive and complete.
--
-- docs/LEARN-AREAS-SPEC.md drafted the 46 fields from the section structure of
-- Wikipedia's Level 3 vital articles without placing the thousand articles
-- themselves. This table holds that placement: one row per article, loaded
-- from the Level 3 page, then placed by a model into one field with a runner-up
-- and a confidence. Three findings come out of it, each a query over this
-- table: articles no field fits, articles two fields fit equally, and fields
-- that receive almost nothing.
--
-- Run by `/api/cron/area-check`, which loads the list on its first call and
-- places whatever is still unplaced on every call after, so stopping halfway
-- costs only the batch it was in.
--
-- Shared and written only by the service role, like the grid it checks. It
-- carries no user_id: it is a finding about the grid, not about anybody.

set search_path = learn, public, extensions;

create table if not exists learn.area_check_articles (
  id uuid primary key default gen_random_uuid(),

  -- The article as the Level 3 page links it.
  title text not null,
  -- The headings it sat under on that page, outermost first, joined with
  -- " > ". Kept so a finding can be read against where Wikipedia put it.
  section text not null,

  -- Null until placed. `topic` is an ordinary subject; the other three are the
  -- kinds of thing the spec places by what they are known for.
  kind text,
  field_id uuid references learn.area_fields (id) on delete set null,
  -- The next best field, when there is one worth naming.
  runner_up_id uuid references learn.area_fields (id) on delete set null,
  -- `clear`: one field fits. `close`: the runner-up fits nearly as well, which
  -- points at a missing boundary rule. `none`: no field fits, which points at a
  -- missing field, and `field_id` is the least bad one.
  confidence text,
  -- One sentence on why, from the model.
  basis text,
  model text,
  placed_at timestamptz,

  created_at timestamptz not null default now(),

  constraint area_check_articles_title_uq unique (title),
  constraint area_check_articles_title_ck check (btrim(title) <> ''),
  constraint area_check_articles_kind_ck
    check (kind is null or kind in ('topic', 'person', 'place', 'work')),
  constraint area_check_articles_confidence_ck
    check (confidence is null or confidence in ('clear', 'close', 'none')),
  -- Placed means all of it or none of it, so a half-written row cannot read as
  -- a finding.
  constraint area_check_articles_placed_ck check (
    (placed_at is null and kind is null and confidence is null)
    or (placed_at is not null and kind is not null and confidence is not null
        and field_id is not null and btrim(coalesce(basis, '')) <> '')
  )
);

-- What the cron call reads each time: the articles still to place.
create index if not exists area_check_articles_unplaced_idx
  on learn.area_check_articles (title)
  where placed_at is null;

create index if not exists area_check_articles_field_idx
  on learn.area_check_articles (field_id);

alter table learn.area_check_articles enable row level security;

drop policy if exists area_check_articles_select on learn.area_check_articles;
create policy area_check_articles_select on learn.area_check_articles for select to authenticated
  using (true);

grant select on learn.area_check_articles to authenticated;
grant all on learn.area_check_articles to service_role;
revoke all on table learn.area_check_articles from anon;

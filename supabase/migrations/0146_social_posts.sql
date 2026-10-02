-- The Posts tab's storage (plan #1415, under #1414).
--
-- Dash drafts X posts about what shipped in this app; the person edits one,
-- posts it themselves and pastes the link back. Dash never posts. Each row is
-- one suggested post and where it stands, so an angle already posted or
-- dropped is not suggested again, and the gap between what Dash drafted and
-- what was posted shows the next run how the person edits.
--
-- public.social_posts, one row per suggested post:
--   platform        'x' only for now.
--   angle           the one idea the post is about, in a short line. The run
--                   compares new angles against posted and dropped ones.
--   status          suggested (on the tab, waiting), posted (the person put it
--                   up and pasted the link), dropped (put aside on the tab).
--   draft           Dash's text as it first wrote it: a jsonb array of
--                   strings, one per post in the thread, one to five long (a
--                   post and up to four more). Never edited after insert.
--   body            the current text, same shape. Starts equal to draft; the
--                   tab's edits change only this.
--   source_plan_item_ids, source_feedback_ids
--                   the plan steps and notes the post was drawn from.
--   image_paths     storage paths of Surfaces screenshots attached (#1418).
--   posted_url      the link the person pasted; posted_at when they did.
--   dropped_at      when it was put aside.
--   run_id          the plan_runs row whose run drafted it.
--
-- The 280-character limit is the tab's counter and the run's check, not a
-- constraint here, so a Premium account's longer posts need no migration.
--
-- A Goals source (lib/dev/sources.ts): what the person posted is a record of
-- what they did.

set search_path = public, extensions;

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  platform text not null default 'x',
  angle text not null,
  status text not null default 'suggested',

  draft jsonb not null,
  body jsonb not null,

  source_plan_item_ids uuid[] not null default '{}',
  source_feedback_ids uuid[] not null default '{}',
  image_paths text[] not null default '{}',

  posted_url text,
  posted_at timestamptz,
  dropped_at timestamptz,

  run_id uuid references public.plan_runs (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint social_posts_platform_ck check (platform in ('x')),
  constraint social_posts_angle_ck check (btrim(angle) <> '' and char_length(angle) <= 300),
  constraint social_posts_status_ck check (status in ('suggested', 'posted', 'dropped')),
  constraint social_posts_draft_ck
    check (jsonb_typeof(draft) = 'array' and jsonb_array_length(draft) between 1 and 5),
  constraint social_posts_body_ck
    check (jsonb_typeof(body) = 'array' and jsonb_array_length(body) between 1 and 5),
  constraint social_posts_posted_ck
    check ((status = 'posted') = (posted_at is not null and posted_url is not null)),
  constraint social_posts_posted_url_ck
    check (posted_url is null or posted_url ~ '^https://\S+$'),
  constraint social_posts_dropped_ck check ((status = 'dropped') = (dropped_at is not null))
);

create index social_posts_user_status_idx
  on public.social_posts (user_id, status, created_at desc);

create trigger social_posts_touch_updated_at
  before update on public.social_posts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: yours and only yours.
-- ---------------------------------------------------------------------------
alter table public.social_posts enable row level security;

create policy social_posts_all on public.social_posts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.social_posts from anon;
grant select, insert, update, delete on public.social_posts to authenticated;
grant all on public.social_posts to service_role;

comment on table public.social_posts is
  'X posts Dash drafted about building this app, with the edited text and whether it was posted (plan #1415).';

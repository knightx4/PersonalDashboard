-- The X connection and every post read from it (plan #1817, under #1815).
--
-- The Posts tab reads the person's own X account so a draft they posted is
-- marked posted without pasting the link, and posts they wrote themselves are
-- listed beside the drafts.
--
-- public.x_accounts, one row per user:
--   x_user_id, handle   who the token reads as.
--   access_token, refresh_token
--                       ciphertext only (lib/crypto/tokens.ts), as
--                       email_accounts does. Plaintext never lands here.
--   token_expires_at    when the access token lapses; refreshed before.
--   status              active, or disconnected after a refresh failed, so the
--                       tab offers Connect again.
--   last_synced_at      when the last read finished.
--   newest_post_id      the newest X post id read; later reads ask for newer.
--
-- public.x_posts, one row per post, unique per user on the X post id:
--   text, created_at    the post and when it went up on X.
--   url                 https://x.com/<handle>/status/<id>.
--   conversation_id     the thread it belongs to; a post whose id equals it
--                       starts a thread.
--   kind                post (starts a thread or is a standalone post),
--                       thread_reply (the person's own reply continuing their
--                       thread) or reply (a reply to someone else). Retweets
--                       are not stored.
--   public_metrics      X's public_metrics object (likes, reposts, replies,
--                       quotes, impressions), refreshed for recent posts.
--   metrics_at          when those numbers were read.
--   read_at             when this row was first stored.
--
-- public.social_posts.x_post_id: the X post id of the post a draft was matched
-- to. posted_url keeps being written when a draft is marked posted, so the tab
-- and the posts run read it as before.
--
-- x_posts is a Goals source (what the person wrote); x_accounts is not.

set search_path = public, extensions;

create table public.x_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  x_user_id text not null,
  handle text not null,

  access_token text,
  refresh_token text,
  token_expires_at timestamptz,

  status text not null default 'active',
  last_synced_at timestamptz,
  newest_post_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint x_accounts_user_key unique (user_id),
  constraint x_accounts_status_ck check (status in ('active', 'disconnected')),
  constraint x_accounts_handle_ck check (btrim(handle) <> '')
);

create trigger x_accounts_touch_updated_at
  before update on public.x_accounts
  for each row execute function public.touch_updated_at();

create table public.x_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  x_post_id text not null,
  text text not null,
  created_at timestamptz not null,
  url text not null,
  conversation_id text,
  kind text not null default 'post',

  public_metrics jsonb not null default '{}',
  metrics_at timestamptz,
  read_at timestamptz not null default now(),

  constraint x_posts_user_post_key unique (user_id, x_post_id),
  constraint x_posts_kind_ck check (kind in ('post', 'thread_reply', 'reply')),
  constraint x_posts_url_ck check (url ~ '^https://\S+$'),
  constraint x_posts_metrics_ck check (jsonb_typeof(public_metrics) = 'object')
);

create index x_posts_user_created_idx on public.x_posts (user_id, created_at desc);
create index x_posts_user_conversation_idx on public.x_posts (user_id, conversation_id);

alter table public.social_posts add column x_post_id text;

create index social_posts_user_x_post_idx
  on public.social_posts (user_id, x_post_id) where x_post_id is not null;

-- ---------------------------------------------------------------------------
-- RLS: yours and only yours.
-- ---------------------------------------------------------------------------
alter table public.x_accounts enable row level security;
alter table public.x_posts enable row level security;

create policy x_accounts_all on public.x_accounts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy x_posts_all on public.x_posts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.x_accounts from anon;
revoke all on public.x_posts from anon;
grant select, insert, update, delete on public.x_accounts to authenticated;
grant select, insert, update, delete on public.x_posts to authenticated;
grant all on public.x_accounts to service_role;
grant all on public.x_posts to service_role;

comment on table public.x_accounts is
  'The connected X account: who it is, its encrypted tokens and how far it has been read (plan #1817).';
comment on table public.x_posts is
  'Every post read from the connected X account, with its public metrics (plan #1817).';
comment on column public.social_posts.x_post_id is
  'The X post id of the post this draft was matched to; null until matched (plan #1817).';

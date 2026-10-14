-- Posting a draft to X from the Posts tab (plan #2072).
--
-- x_accounts.scope keeps the scopes X granted the stored sign-in. Posting
-- needs tweet.write, which sign-ins made before this step do not carry, so
-- the tab reads this column to say "connect again to post" rather than
-- letting X refuse the first post. Null on rows written before it existed,
-- which reads as no write scope.
--
-- social_posts.x_sending_at is set while a draft is being sent and cleared
-- when the send ends. The send claims the draft by setting it only where it
-- is null (or stale), so a second press while the first is still going finds
-- nothing to claim and sends nothing. X refuses a post identical to one just
-- made, and a thread sent twice would also double up its replies.
--
-- social_posts.x_thread_ids holds the ids of the posts of a thread already
-- on X, in order. A thread is sent one post at a time, so a send that stops
-- part-way (a rate limit, X down) leaves the first posts up. The next press
-- carries on from the last id here instead of posting the start again.

alter table public.x_accounts
  add column if not exists scope text;

alter table public.social_posts
  add column if not exists x_sending_at timestamptz,
  add column if not exists x_thread_ids text[] not null default '{}';

comment on column public.x_accounts.scope is
  'The scopes X granted the stored sign-in, space-separated. Posting needs tweet.write (plan #2072).';
comment on column public.social_posts.x_sending_at is
  'Set while the draft is being sent to X, so a second press sends nothing (plan #2072).';
comment on column public.social_posts.x_thread_ids is
  'Ids of the posts of this draft already on X, in thread order (plan #2072).';

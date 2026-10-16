-- A post can be planned: a suggested draft the person has promoted to the
-- Planned section of the Posts tab (plan #2261.1). Only the status check
-- widens; planned rows carry no posted_at, posted_url or dropped_at, so the
-- posted and dropped checks need no change.
alter table public.social_posts drop constraint social_posts_status_ck;
alter table public.social_posts
  add constraint social_posts_status_ck
  check (status in ('suggested', 'planned', 'posted', 'dropped'));

-- Matching posts read from X to drafts (plan #1820, under #1815).
--
-- After every read of X, each post that starts a thread is compared with the
-- first post of each waiting and dropped draft (lib/x/match.ts). A close match
-- marks the draft posted with the post's link and date and sets x_post_id. A
-- weaker one is offered on the draft as "Is this it?", for the person to
-- confirm or turn down.
--
-- public.social_posts gains:
--   x_candidate_id    the X post id the draft is asking about; null when
--                     there is nothing to ask. Cleared when the draft is
--                     marked posted or the person says no.
--   x_dismissed_ids   X post ids the person said were not this draft, so the
--                     same post is never offered for it again.

set search_path = public, extensions;

alter table public.social_posts add column x_candidate_id text;
alter table public.social_posts add column x_dismissed_ids text[] not null default '{}';

comment on column public.social_posts.x_candidate_id is
  'The X post id a near match offers as "Is this it?"; null when there is none (plan #1820).';
comment on column public.social_posts.x_dismissed_ids is
  'X post ids the person said were not this draft, never offered for it again (plan #1820).';

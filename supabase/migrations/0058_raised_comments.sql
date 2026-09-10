-- The thread under a raise: your answer, and the session's reply to it.
--
-- One answer column on `raised_items` would have been less to build, and it
-- was the other half of the decision. It loses the second round: a session
-- that asks about taste usually asks something narrower once you have said
-- what you want, and with a single column that follow-up is a new raise that
-- has lost the thread. A row per message keeps the exchange in one place.
--
-- `author` is 'me' or 'claude' rather than a user id. Both are you in the
-- database sense -- a session writes with your account -- so a uuid here
-- would say the same thing about every row and the page could not tell the
-- two halves of a conversation apart.
--
-- The ownership check is in the insert policy rather than in a trigger: both
-- tables are in `public` and the parent is readable under the same policies,
-- so `exists (… where r.user_id = auth.uid())` is evaluated against rows the
-- caller can already see. A comment on somebody else's raise matches no
-- policy and is refused.

set search_path = public, extensions;

create table if not exists raised_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  raised_item_id uuid not null references raised_items (id) on delete cascade,
  -- Who wrote it: 'me' is you on the page, 'claude' is a session.
  author text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint raised_comments_author_ck check (author in ('me', 'claude')),
  constraint raised_comments_body_not_blank_ck check (length(btrim(body)) > 0),
  constraint raised_comments_body_length_ck check (length(body) <= 4000)
);

-- The order the thread is read in: oldest first, under its raise.
create index if not exists raised_comments_item_created_idx
  on raised_comments (raised_item_id, created_at);

alter table raised_comments enable row level security;

drop policy if exists raised_comments_select on raised_comments;
create policy raised_comments_select on raised_comments for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists raised_comments_insert on raised_comments;
create policy raised_comments_insert on raised_comments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from raised_items r
      where r.id = raised_item_id and r.user_id = (select auth.uid())
    )
  );
drop policy if exists raised_comments_update on raised_comments;
create policy raised_comments_update on raised_comments for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists raised_comments_delete on raised_comments;
create policy raised_comments_delete on raised_comments for delete to authenticated
  using (user_id = (select auth.uid()));

-- Said out loud rather than left to the project's default privileges, for the
-- reasons 0050 spells out.
grant select, insert, update, delete on raised_comments to authenticated;

revoke all on table raised_comments from anon;

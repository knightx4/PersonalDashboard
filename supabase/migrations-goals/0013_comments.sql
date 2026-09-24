-- ===========================================================================
-- Comments on goals and steps (plan #957).
--
-- docs/GOALS-SPEC.md, "Taken from the dev plan": every goal and step has a
-- thread, as a plan step does on /dev/plan, and a comment with @dash in it
-- gets a reply from Claude in the same thread.
--
-- The dev plan's threads live in public.dev_comments, which is owner-only and
-- read by /dev. Goals are for every signed-in account and live in their own
-- schema, so their threads do too:
--
--   comments  one row per message on a goal or a step: who wrote it, what it
--             says, when. A deleted item takes its thread with it.
--
-- author is 'me' for what you write and 'claude' for Dash's replies. Both are
-- written under your account, so the column is what tells the two halves of a
-- thread apart. A comment is written or deleted, never edited.
--
-- A write that says it is Claude's (goals.actor = 'claude') may only add a
-- reply of its own: it cannot write as you, and cannot delete what you wrote.
-- ===========================================================================

create table goals.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  item_id uuid not null,
  author text not null,
  body text not null,

  created_at timestamptz not null default now(),

  constraint comments_item_fk foreign key (item_id, user_id)
    references goals.items (id, user_id) on delete cascade,
  constraint comments_author_ck check (author in ('me', 'claude')),
  constraint comments_body_ck check (btrim(body) <> '' and length(body) <= 4000)
);

create index comments_item_idx on goals.comments (item_id, created_at);

create or replace function goals.comments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') <> 'claude' then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and new.author <> 'claude' then
    raise exception 'Claude may only write its own replies in a thread, not comments as you.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' and old.author <> 'claude' then
    raise exception 'Claude may not delete a comment you wrote.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function goals.comments_guard() from public, anon, authenticated;

create trigger comments_guard before insert or delete on goals.comments
  for each row execute function goals.comments_guard();

alter table goals.history drop constraint history_table_ck;
alter table goals.history add constraint history_table_ck check (
  table_name in (
    'areas', 'items', 'item_goals', 'links', 'runs', 'captures', 'readings', 'periods',
    'suggestions', 'collections', 'collection_goals', 'records', 'comments'
  )
);

create trigger comments_history after insert or update or delete on goals.comments
  for each row execute function goals.record_history();

alter table goals.comments enable row level security;

create policy comments_all on goals.comments for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on goals.comments from anon, public;
grant select, insert, delete on goals.comments to authenticated, service_role;

notify pgrst, 'reload schema';

-- ===========================================================================
-- Context on a goal: what the other modules already hold that bears on it
-- (docs/GOALS-SPEC.md, "Pulling in from the other modules").
--
-- When Claude maps a goal or plans an area it searches the tables the
-- catalogue names (lib/sources/catalogue.ts): a vault note on what you want
-- from a job, your job search thoughts, a Learn aim. What it finds that
-- matters is kept here, one row per thing, with the reason, so the goal page
-- can show it and every later run starts from it instead of searching again.
--
--   context.source    `schema.table`, as the catalogue names it
--   context.ref       the row it points at: its id, or a vault note's path
--   context.title     the row's name, as it was when found
--   context.why       one sentence on why it bears on this goal
--   context.excerpt   the words that matter, quoted, when there are some
--   context.status    proposed (Claude found it), kept (you or Claude on an
--                     approved goal said it belongs) or dismissed (you said
--                     it does not)
--
-- Nothing is copied: the row still lives in its module and the page links to
-- it there. A dismissed row stays, so the same thing is not proposed again.
--
-- Claude (goals.actor = 'claude') may propose context, keep it outright only
-- on an approved goal, and edit or withdraw its own proposals. Dismissing is
-- yours, and a dismissal is final for Claude. The same rules as for steps
-- (0006), in a guard of their own.
--
-- Also: records.source gains 'app', for a draft filled from another module
-- of this app. Its source_ref is `schema.table:ref`.
-- ===========================================================================

create table goals.context (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  item_id uuid not null,
  source text not null,
  ref text not null,
  title text not null,
  why text not null,
  excerpt text,
  status text not null default 'proposed',
  run_id uuid,

  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint context_id_user_key unique (id, user_id),
  -- One row per thing per goal, dismissed ones included, so a dismissal
  -- blocks the same thing coming back.
  constraint context_ref_key unique (item_id, source, ref),

  constraint context_item_fk foreign key (item_id, user_id)
    references goals.items (id, user_id) on delete cascade,
  constraint context_run_fk foreign key (run_id, user_id)
    references goals.runs (id, user_id) on delete set null (run_id),

  constraint context_source_ck check (source ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$'),
  constraint context_ref_ck check (btrim(ref) <> '' and length(ref) <= 1000),
  constraint context_title_ck check (btrim(title) <> '' and length(title) <= 300),
  constraint context_why_ck check (btrim(why) <> '' and length(why) <= 1000),
  constraint context_excerpt_ck check (excerpt is null or length(excerpt) <= 4000),
  constraint context_status_ck check (status in ('proposed', 'kept', 'dismissed'))
);

create index context_item_idx on goals.context (item_id);

create or replace function goals.context_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  goal_level text;
  goal_approved timestamptz;
  is_claude boolean := coalesce(goals.request_value('goals.actor', 'x-goals-actor'), '') = 'claude';
begin
  if tg_op = 'DELETE' then
    if is_claude and old.status <> 'proposed' then
      raise exception 'Claude may withdraw only its own proposals: this context was kept or dismissed by you.'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  select level, approved_at into goal_level, goal_approved
  from goals.items where id = new.item_id and user_id = new.user_id;
  if goal_level is distinct from 'goal' then
    raise exception 'Context belongs on a goal, not a step or an area.'
      using errcode = 'check_violation', constraint = 'context_item_is_goal';
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.decided_at := case when new.status = 'proposed' then null else now() end;
  end if;

  if is_claude then
    if tg_op = 'INSERT' then
      if new.status = 'dismissed' then
        raise exception 'Claude may not write dismissed context: dismissing is the person''s.'
          using errcode = 'check_violation';
      end if;
      if new.status = 'kept' and goal_approved is null then
        raise exception 'This goal is not approved yet: Claude''s context under it goes in as proposed.'
          using errcode = 'check_violation';
      end if;
    else
      if old.status = 'dismissed' then
        raise exception 'The person dismissed this context: leave it as it is.'
          using errcode = 'check_violation';
      end if;
      if new.status = 'dismissed' then
        raise exception 'Claude may not dismiss context: dismissing is the person''s.'
          using errcode = 'check_violation';
      end if;
      if old.status = 'kept' and new.status <> 'kept' then
        raise exception 'This context was kept: Claude may not send it back to proposed.'
          using errcode = 'check_violation';
      end if;
      if new.status = 'kept' and old.status = 'proposed' and goal_approved is null then
        raise exception 'This goal is not approved yet: only the person can keep a proposal.'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function goals.context_check() from public, anon, authenticated;

create trigger context_check before insert or update or delete on goals.context
  for each row execute function goals.context_check();

create trigger context_touch_updated_at before update on goals.context
  for each row execute function goals.touch_updated_at();

alter table goals.history drop constraint history_table_ck;
alter table goals.history add constraint history_table_ck check (
  table_name in (
    'areas', 'items', 'item_goals', 'links', 'runs', 'captures', 'readings', 'periods',
    'suggestions', 'collections', 'collection_goals', 'records', 'comments', 'dependencies',
    'reviews', 'context'
  )
);

create trigger context_history after insert or update or delete on goals.context
  for each row execute function goals.record_history();

alter table goals.context enable row level security;

create policy context_all on goals.context for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on goals.context from anon, public;
grant select, insert, update, delete on goals.context to authenticated, service_role;

comment on table goals.context is
  'What the other modules hold that bears on a goal: a vault note, a job search thought, a Learn aim. Found by Claude from the catalogue in lib/sources, kept or dismissed by you. The row stays in its module; this points at it.';

alter table goals.records drop constraint records_source_ck;
alter table goals.records add constraint records_source_ck check (
  source in ('typed', 'pasted', 'document', 'gmail', 'comment', 'capture', 'app')
);

comment on column goals.records.source_ref is
  'Where the record came from: a Gmail message id, a document path, a comment id, or for source app the `schema.table:ref` of the row in another module.';

notify pgrst, 'reload schema';

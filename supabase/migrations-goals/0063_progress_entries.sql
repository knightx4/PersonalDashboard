-- ===========================================================================
-- Progress entries on steps and goals (plan #1274).
--
-- Feature #1273 lets a sentence such as "moved two bags to the office" count
-- as progress on the step it belongs to without closing it. Until now the
-- capture box filed anything short of finished as a note inside
-- captures.filed, where nothing read it again. This keeps each piece of
-- partial progress as its own dated row on the step or goal it sits on:
--
--   progress_entries.item_id      the step or goal the progress is on.
--   progress_entries.capture_id   the capture it was filed from, when it came
--                                 from the capture box.
--   progress_entries.happened_on  the day it happened, today unless the
--                                 sentence said otherwise.
--   progress_entries.text         what happened, in the person's words.
--   progress_entries.quantity     how much, when the sentence gave a number
--                                 ("two bags" is 2), with its unit ("bags").
--   progress_entries.estimate     a rough answer to "how far along are you?"
--                                 when no total is known: started, half or
--                                 nearly.
--   progress_entries.undone_at    when the entry was taken back. An Undo
--                                 marks the row rather than deleting it, as a
--                                 capture's own filed list does.
--
-- And on a step, what the tally is counted towards, so later steps can say
-- roughly how much is left:
--
--   items.estimated_total   how many in all, when Dash's result or the
--                           person says so (12 bags).
--   items.total_unit        what the total counts ("bags"). A total without
--                           a unit is refused, as a goal's target is (0004).
--
-- A goal's own number stays unit, target and readings (0004): a level read on
-- a date, not a tally, so the total is for steps only.
--
-- History, row level security and grants follow every other goals table.
-- ===========================================================================

create table goals.progress_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  item_id uuid not null,
  capture_id uuid,
  happened_on date not null default current_date,
  text text not null,
  quantity numeric,
  unit text,
  estimate text,

  undone_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint progress_entries_item_fk foreign key (item_id, user_id)
    references goals.items (id, user_id) on delete cascade,
  constraint progress_entries_capture_fk foreign key (capture_id, user_id)
    references goals.captures (id, user_id) on delete set null (capture_id),

  constraint progress_entries_text_ck check (btrim(text) <> '' and length(text) <= 2000),
  constraint progress_entries_quantity_ck check (quantity is null or quantity > 0),
  constraint progress_entries_unit_ck check (
    unit is null or (quantity is not null and btrim(unit) <> '' and length(unit) <= 40)
  ),
  constraint progress_entries_estimate_ck check (
    estimate is null or estimate in ('started', 'half', 'nearly')
  )
);

create index progress_entries_user_item_idx on goals.progress_entries (user_id, item_id);
create index progress_entries_capture_idx on goals.progress_entries (capture_id)
  where capture_id is not null;

create trigger progress_entries_touch_updated_at before update on goals.progress_entries
  for each row execute function goals.touch_updated_at();

alter table goals.history drop constraint history_table_ck;
alter table goals.history add constraint history_table_ck check (
  table_name in (
    'areas', 'items', 'item_goals', 'links', 'runs', 'captures', 'readings', 'periods',
    'suggestions', 'collections', 'collection_goals', 'records', 'comments', 'dependencies',
    'reviews', 'context', 'answers', 'briefs', 'document_kinds', 'progress_entries'
  )
);

create trigger progress_entries_history after insert or update or delete on goals.progress_entries
  for each row execute function goals.record_history();

alter table goals.progress_entries enable row level security;

create policy progress_entries_all on goals.progress_entries for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on goals.progress_entries from anon, public;
grant select, insert, update, delete on goals.progress_entries to authenticated, service_role;

comment on table goals.progress_entries is
  'Partial progress on a step or goal, one dated row per report, with an optional quantity and unit or a rough estimate (plan #1274). Undo sets undone_at.';

-- ---------------------------------------------------------------------------
-- The total a step's tally counts towards.
-- ---------------------------------------------------------------------------
alter table goals.items
  add column estimated_total numeric,
  add column total_unit text;

alter table goals.items
  add constraint items_estimated_total_ck check (
    estimated_total is null or (level = 'step' and estimated_total > 0 and total_unit is not null)
  );

alter table goals.items
  add constraint items_total_unit_ck check (
    total_unit is null or (level = 'step' and btrim(total_unit) <> '' and length(total_unit) <= 40)
  );

comment on column goals.items.estimated_total is
  'On a step, how many in all its progress entries count towards (plan #1274). Never without total_unit.';
comment on column goals.items.total_unit is
  'On a step, what estimated_total counts, such as "bags" (plan #1274).';

notify pgrst, 'reload schema';

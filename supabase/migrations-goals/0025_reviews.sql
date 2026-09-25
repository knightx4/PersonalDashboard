-- ===========================================================================
-- A weekly verdict on each open goal (plan #1018).
--
-- Once a week the goals routine's weekly run reads every open goal against
-- its done-when and writes one row here per goal:
--
--   reviews.verdict    on_track, stalled or waiting_on_you
--   reviews.reason     one sentence on why
--   reviews.next_move  one sentence on what should happen next
--   reviews.step_id    for a stalled goal, the step the run proposed under
--                      the goal for that next move. Required when the
--                      verdict is stalled, so a stalled goal always comes
--                      with something to approve.
--   reviews.run_id     the weekly run that wrote it
--
-- The Goals home shows the newest row for each goal on the goal's card. Rows
-- are never updated: each week adds a new one, and older ones stay as the
-- record of how the goal was read over time.
--
-- The routine writes through the connector. The app only reads, so the
-- signed-in role gets select and nothing else.
-- ===========================================================================

create table goals.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  item_id uuid not null,
  run_id uuid,
  step_id uuid,

  verdict text not null,
  reason text not null,
  next_move text not null,

  created_at timestamptz not null default now(),

  constraint reviews_item_fk foreign key (item_id, user_id)
    references goals.items (id, user_id) on delete cascade,
  constraint reviews_run_fk foreign key (run_id, user_id)
    references goals.runs (id, user_id) on delete set null (run_id),
  constraint reviews_step_fk foreign key (step_id, user_id)
    references goals.items (id, user_id) on delete set null (step_id),

  constraint reviews_verdict_ck check (verdict in ('on_track', 'stalled', 'waiting_on_you')),
  constraint reviews_reason_ck check (btrim(reason) <> '' and length(reason) <= 500),
  constraint reviews_next_move_ck check (btrim(next_move) <> '' and length(next_move) <= 500),
  constraint reviews_stalled_step_ck check (verdict <> 'stalled' or step_id is not null)
);

-- The home reads the newest row per goal.
create index reviews_item_created_idx on goals.reviews (user_id, item_id, created_at desc);
create index reviews_run_idx on goals.reviews (run_id) where run_id is not null;
create index reviews_step_idx on goals.reviews (step_id) where step_id is not null;

alter table goals.reviews enable row level security;

create policy reviews_select on goals.reviews for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on goals.reviews from anon, public;
grant select on goals.reviews to authenticated;
grant select, insert on goals.reviews to service_role;

comment on table goals.reviews is
  'The weekly run''s verdict on each open goal (plan #1018): on track, stalled or waiting on you, with why and the next move. The newest per goal shows on its card on the Goals home.';

notify pgrst, 'reload schema';

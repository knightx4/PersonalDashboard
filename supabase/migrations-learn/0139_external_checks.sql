-- One external item set, sat once, and the score kept (plan #2179.4).
--
-- Learn's own questions are written by the app and about what the person is
-- learning, so a score on them says little about whether lens progress is
-- real. An external set is thirty or so published questions on a subject,
-- which neither the person nor the app wrote. It is answered once and scored,
-- and the score is the anchor that later lens progress is compared against.
--
-- One row per set sat. The set is pasted in, so its items live on the row as
-- jsonb: an array of { question, expected, response, correct }, in the order
-- they are served. response and correct are null until the item is answered.
-- A skipped item has an empty response and correct false.
--
-- The items are not concepts, probes or claims, and nothing here writes to the
-- map. Reading a score is the only thing a later step does with this table.
--
-- scored_at is null while the set is being sat and set when the last item is
-- answered, together with correct_count. The date shown beside the name is
-- scored_at, or created_at for a set not finished.

set search_path = learn, public, extensions;

create table learn.external_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- What the set is called, as the person named it: "FP&A practice set, Oct 2026".
  name text not null,
  -- The items in the order they are served.
  items jsonb not null,
  -- Items marked right, once scored. Null until then.
  correct_count integer,
  scored_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint external_checks_name_ck check (name <> ''),
  constraint external_checks_items_ck
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  constraint external_checks_score_ck
    check (
      (scored_at is null and correct_count is null)
      or (scored_at is not null and correct_count is not null and correct_count >= 0)
    )
);

comment on table learn.external_checks is
  'External item sets sat once: the pasted items with the answers given, and the score kept with its date. Nothing on the map reads or changes because of a row here.';
comment on column learn.external_checks.items is
  'Array of { question, expected, response, correct } in serving order; response and correct are null until answered.';
comment on column learn.external_checks.correct_count is
  'Items marked right. Null until the last item is answered.';
comment on column learn.external_checks.scored_at is
  'When the last item was answered and the score fixed. Null while the set is still being sat.';

create index external_checks_user_created_idx
  on learn.external_checks (user_id, created_at desc);

create trigger external_checks_touch_updated_at
  before update on learn.external_checks
  for each row execute function learn.touch_updated_at();

alter table learn.external_checks enable row level security;

create policy external_checks_all on learn.external_checks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on learn.external_checks from anon;

grant select, insert, update, delete on learn.external_checks to authenticated, service_role;

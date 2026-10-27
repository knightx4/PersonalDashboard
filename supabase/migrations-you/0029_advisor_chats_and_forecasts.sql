-- Avatars, one-on-one chats with memory, probability forecasts, premortems
-- and tripwires for the advisors (plan #2581.1, under #2581).
--
-- The board is becoming advisors the person talks to one at a time, and
-- decisions the advisors answer blind with probabilities that can be scored
-- later. This migration stores all of it; no screen or routine uses it yet.
--
-- 1. you.board_advisors gains
--
--   avatar         jsonb object: the DiceBear Notionists drawing,
--                  { style: 'notionists', seed: text, options: { … } },
--                  options being DiceBear's own (hair, eyes, glasses, …).
--                  Null draws the default from the advisor's key.
--   believability  jsonb object keyed by topic (work, money, learning,
--                  projects, place, time):
--                  { <topic>: { scored: int, brier: number, updated_at } },
--                  scored being how many of their forecasts were scored and
--                  brier their mean Brier score (0 best, 1 worst). Empty
--                  until a reviewed decision scores a forecast.
--
-- 2. you.advisor_chats, you.advisor_messages
--
-- A one-on-one talk with one advisor. A chat has a title and the time of its
-- last message, which a trigger keeps. A message is the person's (role
-- person) or the advisor's (role advisor, written by Dash), with receipts
-- [ { label, link } ] for what an advisor's message rests on.
--
-- 3. you.advisor_memory
--
-- What an advisor keeps between talks and meetings: kind is fact,
-- preference, commitment or open_thread. source_message_id or
-- source_question_id names where it was learnt. retired_at is set when it
-- stops being true, so it is kept but no longer read. Every chat and meeting
-- reads an advisor's unretired memory first.
--
-- 4. you.board_turns gains, for the questions' options by letter,
--
--   probabilities  { <letter>: number 0 to 1 }: the advisor's probability
--                  that the option meets the question's success_measure.
--   ranges         { <letter>: { low, high, unit? } }: a 90% range for the
--                  measure under that option, low <= high.
--   budget         { <letter>: integer >= 0 }: 100 points spread over the
--                  options; they sum to 100.
--   change_mind    what would change the advisor's mind.
--   assessment     the one question this advisor answered (their own seat's
--                  question, or the one they took up on this decision).
--   model          the model that wrote the turn.
--   blind          true for a round-1 turn written without seeing the
--                  others'. False on every turn already held.
--
-- 5. you.board_questions gains
--
--   door              one_way (hard to undo) or two_way.
--   success_measure   how the person will know it went well.
--   decide_by         the date they mean to decide by.
--   premortem         [ { advisor, text, signal? } ]: each failure story,
--                     told as if a year on it went badly, by advisor key.
--   tripwire          { condition, check_on (date), status }: status is
--                     watching, tripped or cleared.
--   lean_probability  the person's own probability, 0 to 1, that their lean
--                     meets the success measure.
--   option_order      { <advisor key>: [ letters ] }: the order each advisor
--                     was shown the options in, so order cannot steer them.
--
-- Schema change only. Every new column is null or has an empty default, so
-- the meetings already held, their questions and turns read as before. No
-- row of any account is written.

set search_path = you, public, extensions;

-- ---------------------------------------------------------------------------
-- 0. Checks on per-option maps, shared by the new columns.
-- ---------------------------------------------------------------------------

-- Every value of a { <letter>: number } map is a number in [lo, hi].
create or replace function you.board_number_map_ok(m jsonb, lo numeric, hi numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select m is null or case
    when jsonb_typeof(m) <> 'object' then false
    else not exists (
      select 1 from jsonb_each(m) e
      where case
        when jsonb_typeof(e.value) <> 'number' then true
        else (e.value)::numeric < lo or (e.value)::numeric > hi
      end
    )
  end;
$$;

-- A 100-point budget: whole points, none negative, summing to 100.
create or replace function you.board_budget_ok(m jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select m is null or case
    when not you.board_number_map_ok(m, 0, 100) then false
    else not exists (
        select 1 from jsonb_each(m) e where (e.value)::numeric <> trunc((e.value)::numeric)
      )
      and (select coalesce(sum((e.value)::numeric), 0) from jsonb_each(m) e) = 100
  end;
$$;

-- A { <letter>: { low, high, unit? } } map with low <= high.
create or replace function you.board_ranges_ok(m jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select m is null or case
    when jsonb_typeof(m) <> 'object' then false
    else not exists (
      select 1 from jsonb_each(m) e
      where case
        when jsonb_typeof(e.value) <> 'object' then true
        when jsonb_typeof(e.value -> 'low') is distinct from 'number' then true
        when jsonb_typeof(e.value -> 'high') is distinct from 'number' then true
        else (e.value ->> 'low')::numeric > (e.value ->> 'high')::numeric
      end
    )
  end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Advisors: avatar and believability.
-- ---------------------------------------------------------------------------

alter table you.board_advisors
  add column avatar jsonb,
  add column believability jsonb not null default '{}'::jsonb;

alter table you.board_advisors
  add constraint board_advisors_avatar_ck check (
    avatar is null or (jsonb_typeof(avatar) = 'object' and jsonb_typeof(avatar -> 'seed') is not distinct from 'string')
  ),
  add constraint board_advisors_believability_ck check (jsonb_typeof(believability) = 'object');

comment on column you.board_advisors.avatar is
  'The DiceBear Notionists drawing: { style, seed, options }; null draws the default from the key (plan #2581.1).';
comment on column you.board_advisors.believability is
  'Track record by topic: { <topic>: { scored, brier, updated_at } }, brier the mean Brier score of their scored forecasts (plan #2581.1).';

-- ---------------------------------------------------------------------------
-- 2. One-on-one chats and their messages.
-- ---------------------------------------------------------------------------

create table you.advisor_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  advisor_id uuid not null,
  title text check (title is null or (btrim(title) <> '' and char_length(title) <= 200)),
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint advisor_chats_id_user_id_key unique (id, user_id),
  foreign key (advisor_id, user_id)
    references you.board_advisors (id, user_id) on delete cascade
);

comment on table you.advisor_chats is
  'A one-on-one talk between the person and one advisor (plan #2581.1).';

create index advisor_chats_advisor_idx
  on you.advisor_chats (user_id, advisor_id, last_message_at desc nulls last);

create trigger advisor_chats_touch_updated_at
  before update on you.advisor_chats
  for each row execute function you.touch_updated_at();

create table you.advisor_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id uuid not null,
  role text not null,
  text text not null check (btrim(text) <> '' and char_length(text) <= 20000),
  receipts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),

  constraint advisor_messages_role_ck check (role in ('person', 'advisor')),
  constraint advisor_messages_receipts_ck check (jsonb_typeof(receipts) = 'array'),
  constraint advisor_messages_id_user_id_key unique (id, user_id),
  foreign key (chat_id, user_id)
    references you.advisor_chats (id, user_id) on delete cascade
);

comment on table you.advisor_messages is
  'Each message of a one-on-one talk: the person''s, or the advisor''s written by Dash, with receipts (plan #2581.1).';

create index advisor_messages_chat_idx on you.advisor_messages (chat_id, created_at);
create index advisor_messages_user_idx on you.advisor_messages (user_id);

-- The chat's last_message_at follows its newest message.
create or replace function you.advisor_messages_touch_chat()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update you.advisor_chats
     set last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at)
   where id = new.chat_id;
  return new;
end;
$$;

create trigger advisor_messages_touch_chat
  after insert on you.advisor_messages
  for each row execute function you.advisor_messages_touch_chat();

-- ---------------------------------------------------------------------------
-- 3. What each advisor remembers.
-- ---------------------------------------------------------------------------

create table you.advisor_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  advisor_id uuid not null,
  kind text not null,
  text text not null check (btrim(text) <> '' and char_length(text) <= 1000),
  source_message_id uuid,
  source_question_id uuid,
  created_at timestamptz not null default now(),
  retired_at timestamptz,

  constraint advisor_memory_kind_ck check (kind in ('fact', 'preference', 'commitment', 'open_thread')),
  foreign key (advisor_id, user_id)
    references you.board_advisors (id, user_id) on delete cascade,
  foreign key (source_message_id, user_id)
    references you.advisor_messages (id, user_id) on delete set null (source_message_id),
  foreign key (source_question_id, user_id)
    references you.board_questions (id, user_id) on delete set null (source_question_id)
);

comment on table you.advisor_memory is
  'What an advisor keeps between talks and meetings: facts, preferences, commitments and open threads, each with where it was learnt; retired_at once no longer true (plan #2581.1).';

create index advisor_memory_advisor_idx
  on you.advisor_memory (user_id, advisor_id, created_at desc) where retired_at is null;
create index advisor_memory_message_idx on you.advisor_memory (source_message_id) where source_message_id is not null;
create index advisor_memory_question_idx on you.advisor_memory (source_question_id) where source_question_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Turns: forecasts.
-- ---------------------------------------------------------------------------

alter table you.board_turns
  add column probabilities jsonb,
  add column ranges jsonb,
  add column budget jsonb,
  add column change_mind text check (change_mind is null or char_length(change_mind) <= 2000),
  add column assessment text check (assessment is null or char_length(assessment) <= 500),
  add column model text check (model is null or char_length(model) <= 100),
  add column blind boolean not null default false;

alter table you.board_turns
  add constraint board_turns_probabilities_ck check (you.board_number_map_ok(probabilities, 0, 1)),
  add constraint board_turns_ranges_ck check (you.board_ranges_ok(ranges)),
  add constraint board_turns_budget_ck check (you.board_budget_ok(budget)),
  add constraint board_turns_blind_ck check (not blind or round = 1);

comment on column you.board_turns.probabilities is
  'The advisor''s probability, 0 to 1, that each option meets the question''s success measure: { <letter>: number } (plan #2581.1).';
comment on column you.board_turns.ranges is
  'A 90% range for the success measure under each option: { <letter>: { low, high, unit? } } (plan #2581.1).';
comment on column you.board_turns.budget is
  'One hundred points spread over the options: { <letter>: whole points }, summing to 100 (plan #2581.1).';
comment on column you.board_turns.change_mind is
  'What would change this advisor''s mind (plan #2581.1).';
comment on column you.board_turns.assessment is
  'The one question this advisor answered on this decision (plan #2581.1).';
comment on column you.board_turns.model is
  'The model that wrote the turn (plan #2581.1).';
comment on column you.board_turns.blind is
  'True for a round-1 turn written without seeing the other advisors''; false on every turn held before (plan #2581.1).';

-- ---------------------------------------------------------------------------
-- 5. Questions: the shape of a decision.
-- ---------------------------------------------------------------------------

alter table you.board_questions
  add column door text,
  add column success_measure text
    check (success_measure is null or (btrim(success_measure) <> '' and char_length(success_measure) <= 1000)),
  add column decide_by date,
  add column premortem jsonb,
  add column tripwire jsonb,
  add column lean_probability numeric(4, 3),
  add column option_order jsonb;

alter table you.board_questions
  add constraint board_questions_door_ck check (door is null or door in ('one_way', 'two_way')),
  add constraint board_questions_premortem_ck check (premortem is null or jsonb_typeof(premortem) = 'array'),
  add constraint board_questions_tripwire_ck check (
    tripwire is null or (
      jsonb_typeof(tripwire) = 'object'
      and jsonb_typeof(tripwire -> 'condition') is not distinct from 'string'
      and coalesce(tripwire ->> 'status', 'watching') in ('watching', 'tripped', 'cleared')
    )
  ),
  add constraint board_questions_lean_probability_ck check (
    lean_probability is null or lean_probability between 0 and 1
  ),
  add constraint board_questions_option_order_ck check (
    option_order is null or jsonb_typeof(option_order) = 'object'
  );

comment on column you.board_questions.door is
  'one_way for a decision hard to undo, two_way for one easy to reverse (plan #2581.1).';
comment on column you.board_questions.success_measure is
  'How the person will know the decision went well; the advisors'' probabilities are of meeting it (plan #2581.1).';
comment on column you.board_questions.decide_by is
  'The date the person means to decide by (plan #2581.1).';
comment on column you.board_questions.premortem is
  'Failure stories told as if it went badly a year on: [ { advisor, text, signal? } ] (plan #2581.1).';
comment on column you.board_questions.tripwire is
  'The condition that reopens the decision: { condition, check_on, status }, status watching, tripped or cleared (plan #2581.1).';
comment on column you.board_questions.lean_probability is
  'The person''s own probability, 0 to 1, that their lean meets the success measure (plan #2581.1).';
comment on column you.board_questions.option_order is
  'The order each advisor was shown the options in: { <advisor key>: [ letters ] } (plan #2581.1).';

-- ---------------------------------------------------------------------------
-- 6. Row level security: each person's rows are theirs alone.
-- ---------------------------------------------------------------------------

alter table you.advisor_chats enable row level security;
alter table you.advisor_messages enable row level security;
alter table you.advisor_memory enable row level security;

create policy advisor_chats_all on you.advisor_chats for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy advisor_messages_all on you.advisor_messages for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy advisor_memory_all on you.advisor_memory for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.advisor_chats, you.advisor_messages, you.advisor_memory from anon, authenticated;
grant select, insert, update, delete
  on you.advisor_chats, you.advisor_messages, you.advisor_memory
  to authenticated, service_role;

revoke all on function you.board_number_map_ok(jsonb, numeric, numeric) from public, anon;
revoke all on function you.board_budget_ok(jsonb) from public, anon;
revoke all on function you.board_ranges_ok(jsonb) from public, anon;
revoke all on function you.advisor_messages_touch_chat() from public, anon, authenticated;
grant execute on function you.board_number_map_ok(jsonb, numeric, numeric) to authenticated, service_role;
grant execute on function you.board_budget_ok(jsonb) to authenticated, service_role;
grant execute on function you.board_ranges_ok(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';

-- The spend ledger: what every model call actually cost.
--
-- Built before the thing it measures, which is the only order that works. A
-- cost estimate written in a spec is a guess until something records the real
-- number beside it, and the way you otherwise find out you were wrong is a
-- bill at the end of the month with one line on it.
--
-- `core` rather than `learn`: the reading queue is not the only part of this
-- app that spends. The job side extracts, enriches and drafts; shopping reads
-- receipts and photographs shelves. A per-module spend table would be six
-- tables with the same six columns, and the one question worth asking --
-- "where is the money going" -- would need a union to answer. This is the same
-- argument that put ingestion and account settings here.
--
-- Two things are deliberate and worth arguing from later:
--
-- **Append-only.** Select and insert, no update, no delete. A ledger somebody
-- can quietly edit answers nothing, and there is no legitimate reason to
-- change what a call cost after it happened. Rows go when the account does.
--
-- **Cost is integer micro-dollars, not cents.** One Haiku call costs about two
-- hundredths of a cent. In integer cents -- which is the rule everywhere else
-- in this codebase -- every row in this table would round to zero and the
-- total would be a lie. A micro-dollar is a millionth of a dollar, so the
-- smallest call is still hundreds of units and the arithmetic stays integer.
-- lib/money.ts remains the only place that formats any of it.

set search_path = core, public, extensions;

create table core.model_spend (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Which workspace spent it, and what it was doing. `operation` is the column
  -- that makes this answerable a week later: "learn spent $2" is a number,
  -- "learn/plan-topic spent $2 over eleven calls" is a finding.
  module text not null,
  operation text not null,
  model text not null,

  -- What the API reported, not what we asked for. Cache reads and cache writes
  -- are priced differently from ordinary input -- a tenth and a quarter
  -- again respectively -- so collapsing them into one number would make the
  -- cheap calls look expensive and hide whether caching is working at all.
  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  output_tokens integer not null default 0,

  -- Millionths of a dollar. Null when the model was not in the price table at
  -- the time of the call: the tokens are still recorded, so the cost can be
  -- computed later, and a null reads as "not known" on the screen. Zero would
  -- be a claim -- the same reason the share page renders an unknown price
  -- blank rather than as $0.00.
  cost_micros bigint,

  created_at timestamptz not null default now(),

  constraint model_spend_module_ck check (module <> ''),
  constraint model_spend_operation_ck check (operation <> ''),
  constraint model_spend_model_ck check (model <> ''),
  constraint model_spend_tokens_ck check (
    input_tokens >= 0
    and cached_input_tokens >= 0
    and cache_write_tokens >= 0
    and output_tokens >= 0
  ),
  constraint model_spend_cost_ck check (cost_micros is null or cost_micros >= 0)
);

-- The two questions the screen asks: everything of mine newest first, and
-- everything of mine since a date. One index answers both.
create index model_spend_user_created_idx
  on core.model_spend (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS. Yours and only yours, and append-only for everyone.
-- ---------------------------------------------------------------------------
alter table core.model_spend enable row level security;

create policy model_spend_select on core.model_spend for select to authenticated
  using (user_id = (select auth.uid()));
create policy model_spend_insert on core.model_spend for insert to authenticated
  with check (user_id = (select auth.uid()));

-- No update and no delete policy, deliberately. A spend row is a record of
-- something that already happened; the only correct edit is none. Rows leave
-- with the account, by cascade.

revoke all on core.model_spend from anon;
grant select, insert on core.model_spend to authenticated, service_role;

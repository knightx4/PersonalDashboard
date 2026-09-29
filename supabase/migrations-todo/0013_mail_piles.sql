-- The pile Jev puts each email in, beside the rules that route it (plan #1173).
--
-- Four linkers read the shared inbox (lib/core/inbox/fan-out.ts), each with
-- its own sender and subject rules: commerce claims orders, jobs claims job
-- mail, recurring claims bills and subscriptions, appointments claims
-- bookings. Feature #1172 moves that routing to one Jev question asked of
-- every email. This step asks it and stores the answer without acting on it:
-- the rules stay in charge until the comparison below shows where Jev can
-- replace them.
--
-- core.mail_piles holds one row per email Jev sorted: the pile, how sure it
-- was, and the model version. The rules' answers stay where they are, in each
-- linker's own verdict table keyed by the same message id, and
-- core.mail_pile_comparison reads the two side by side.
--
-- In this folder rather than supabase/migrations because the comparison reads
-- job_search and todo tables, which are built after that folder
-- (scripts/db-reset.sh). The same reason put core.scrub_unclaimed_messages()
-- in 0011_appointments.sql.
--
-- The scrub still wipes the sender and subject of mail no linker claimed. The
-- pile is kept: it is one word about the email, and it is what the comparison
-- counts. It goes when the message row goes.
--
-- Bookkeeping, so not a source for Goals (lib/core/sources.ts). The sync
-- writes with the service role; the person may read their own rows.

set search_path = core, public, extensions;

create table if not exists core.mail_piles (
  id uuid primary key references core.ingested_messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  pile text not null,
  confidence real not null,
  model text not null,
  created_at timestamptz not null default now(),
  constraint mail_piles_pile_ck check (
    pile in ('job', 'order', 'bill', 'appointment', 'newsletter', 'needs_reply', 'personal', 'other')
  ),
  constraint mail_piles_confidence_ck check (confidence >= 0 and confidence <= 1),
  constraint mail_piles_model_ck check (btrim(model) <> '' and length(model) <= 100)
);

create index if not exists mail_piles_user_idx on core.mail_piles (user_id, pile);

alter table core.mail_piles enable row level security;

drop policy if exists mail_piles_select on core.mail_piles;
create policy mail_piles_select on core.mail_piles for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on core.mail_piles from public, anon, authenticated;
grant select on core.mail_piles to authenticated;
grant select, insert, update, delete on core.mail_piles to service_role;

comment on table core.mail_piles is
  'The pile Jev put each ingested email in, and how sure it was (plan #1173). Read beside the linkers'' own verdicts by core.mail_pile_comparison.';

-- Mail the sweep can still sort: not scrubbed, so it has a sender or subject
-- to read, and no pile yet. Newest first, so a backlog fills in from today.
create or replace function core.mail_piles_unsorted(p_account_id uuid, p_limit integer)
returns table (
  id uuid,
  provider_message_id text,
  thread_id text,
  received_at timestamptz,
  from_address text,
  reply_to_address text,
  subject text
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.provider_message_id, m.thread_id, m.received_at,
         m.from_address, m.reply_to_address, m.subject
  from core.ingested_messages m
  where m.email_account_id = p_account_id
    and m.scrubbed_at is null
    and (m.subject is not null or m.from_address is not null)
    and not exists (select 1 from core.mail_piles p where p.id = m.id)
  order by m.received_at desc nulls last
  limit greatest(0, least(p_limit, 500));
$$;

-- Each sorted email with the piles its linkers put it in. A linker's pile is
-- its final verdict: commerce and jobs when the classification is anything
-- but not_relevant, recurring and appointments when the rules claimed it and
-- the reading did not then turn it down. An email can sit in more than one
-- (an order that is also a subscription) or in none.
create or replace function core.mail_pile_comparison(p_user_id uuid)
returns table (
  message_id uuid,
  received_at timestamptz,
  from_address text,
  subject text,
  pile text,
  confidence real,
  rule_piles text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, m.received_at, m.from_address, m.subject, p.pile, p.confidence,
         array_remove(array[
           case when exists (
             select 1 from job_search.ingested_messages j
             where j.id = p.id
               and j.classification <> 'not_relevant'::job_search.message_classification
           ) then 'job' end,
           case when exists (
             select 1 from public.ingested_messages c
             where c.id = p.id
               and c.classification <> 'not_relevant'::public.message_classification
           ) then 'order' end,
           case when exists (
             select 1 from public.recurring_messages r
             where r.id = p.id and r.claimed and r.parse_status <> 'not_recurring'
           ) then 'bill' end,
           case when exists (
             select 1 from todo.appointment_messages a
             where a.id = p.id and a.claimed and a.parse_status <> 'not_appointment'
           ) then 'appointment' end
         ], null) as rule_piles
  from core.mail_piles p
  join core.ingested_messages m on m.id = p.id
  where p.user_id = p_user_id;
$$;

-- How often Jev and each linker agree, over the emails Jev sorted. One row per
-- linker, for the pile it owns, and one per pile no linker owns.
--
--   rules          emails the linker put in its pile
--   jev, jev_sure  emails Jev put there, and those at or above the floor
--   agree          both
--   rules_only     the linker did and Jev did not
--   jev_only       Jev did and the linker did not; jev_only_sure at the floor
--   agreement      agree over the emails either put there, null when none
create or replace function core.mail_pile_agreement(p_user_id uuid, p_floor real default 0.8)
returns table (
  linker text,
  pile text,
  rules integer,
  jev integer,
  jev_sure integer,
  agree integer,
  rules_only integer,
  jev_only integer,
  jev_only_sure integer,
  agreement numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with piles (linker, pile, ord) as (
    values ('jobs', 'job', 1), ('commerce', 'order', 2), ('recurring', 'bill', 3),
           ('appointments', 'appointment', 4), (null, 'newsletter', 5),
           (null, 'needs_reply', 6), (null, 'personal', 7), (null, 'other', 8)
  ),
  sorted as (select * from core.mail_pile_comparison(p_user_id)),
  counted as (
    select k.linker, k.pile, k.ord,
      count(*) filter (where k.pile = any (r.rule_piles))::integer as rules,
      count(*) filter (where r.pile = k.pile)::integer as jev,
      count(*) filter (where r.pile = k.pile and r.confidence >= p_floor)::integer as jev_sure,
      count(*) filter (where r.pile = k.pile and k.pile = any (r.rule_piles))::integer as agree,
      count(*) filter (where r.pile <> k.pile and k.pile = any (r.rule_piles))::integer as rules_only,
      count(*) filter (where r.pile = k.pile and not (k.pile = any (r.rule_piles)))::integer as jev_only,
      count(*) filter (
        where r.pile = k.pile and not (k.pile = any (r.rule_piles)) and r.confidence >= p_floor
      )::integer as jev_only_sure
    from piles k
    left join sorted r on true
    group by k.linker, k.pile, k.ord
  )
  select linker, pile, rules, jev, jev_sure, agree, rules_only, jev_only, jev_only_sure,
         case when agree + rules_only + jev_only = 0 then null
              else round(agree::numeric / (agree + rules_only + jev_only), 3) end
  from counted
  order by ord;
$$;

revoke all on function core.mail_piles_unsorted(uuid, integer) from public, anon, authenticated;
revoke all on function core.mail_pile_comparison(uuid) from public, anon, authenticated;
revoke all on function core.mail_pile_agreement(uuid, real) from public, anon, authenticated;
grant execute on function core.mail_piles_unsorted(uuid, integer) to service_role;
grant execute on function core.mail_pile_comparison(uuid) to service_role;
grant execute on function core.mail_pile_agreement(uuid, real) to service_role;

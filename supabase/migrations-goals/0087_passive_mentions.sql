-- ===========================================================================
-- Mentions of what is coming up under a passive goal (plan #2503.5).
--
-- A passive goal (0086) asks for no attention, so its steps and suggestions
-- stay out of Do next, Todo and the verdicts. A dated one coming up within
-- seven days is still worth a quiet line: the morning brief asks Dash to
-- mention it once in the home's note, and the Goals home lists it as a plain
-- line with Dismiss. Both are worked out from the tree and the suggestions on
-- each read (lib/goals/passive-mentions.ts); this table holds only what has
-- to outlast a read:
--
--   mentions.ref           what was mentioned: 'step:<goals.items id>' or
--                          'suggestion:<goals.suggestions id>'. One row per
--                          ref, so a step whose date moves is still the same
--                          mention.
--   mentions.on_date       the date it was mentioned for, for the record.
--   mentions.mentioned_at  when a morning brief listed it for the note. A
--                          brief lists only refs without one, so the note
--                          mentions each once.
--   mentions.dismissed_at  when you pressed Dismiss on the home. A dismissed
--                          ref is neither listed on the home nor briefed again.
--
-- Bookkeeping, so it keeps no history. The person reads and writes their own
-- rows; the morning run writes mentioned_at with the service role.
-- ===========================================================================

create table goals.mentions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  ref text not null,
  on_date date not null,
  mentioned_at timestamptz,
  dismissed_at timestamptz,

  created_at timestamptz not null default now(),

  constraint mentions_ref_ck check (
    ref ~ '^(step|suggestion):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  constraint mentions_user_ref_uq unique (user_id, ref)
);

alter table goals.mentions enable row level security;

create policy mentions_all on goals.mentions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on goals.mentions from anon, public;
grant select, insert, update on goals.mentions to authenticated, service_role;

comment on table goals.mentions is
  'Which dated steps and suggestions under a passive goal the morning note has mentioned and which you dismissed on the Goals home, one row per ref (plan #2503.5).';

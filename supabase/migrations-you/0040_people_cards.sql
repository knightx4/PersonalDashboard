-- Adding and editing the people you chat with (plan #2748.11, under #2748).
--
-- The People tab in Chat lets the person add someone of their own and change
-- anyone already there, the sixteen mentors included: name, colour, who they
-- are, how they talk, what they care about, and the persona card a reply
-- reads (you.board_advisors.persona, you 0038). This migration stores what
-- that needs.
--
-- 1. you.board_advisors gains
--
--   persona_brief   what the person filled in on the form, as a jsonb
--                   object, so Edit opens on what they wrote last time:
--                     who     text: who they are
--                     length  short | medium | long: how long a reply runs
--                     bubbles one | few | many: how many texts a reply is
--                     tone    text: how they sound
--                     cares   text: what they should care about
--                     never   text: things they should never say
--                   Null for a mentor nobody has edited.
--   joins_meetings  whether the board chair may seat them. True for every
--                   row already here, so the board is as it was; a person
--                   added from Chat starts false and is in Chat only, until
--                   they turn it on from the person's page.
--
-- 2. you.advisor_persona_versions
--
-- Every persona card a person has had before the current one, so an earlier
-- card can be brought back. Saving a new card writes the card it replaces
-- here. made_by is you (typed or edited by the person) or dash (drafted or
-- redrafted by Dash); ask is the sentence a redraft was asked with.
--
-- Schema change only. No row of any account is written.

set search_path = you, public, extensions;

alter table you.board_advisors
  add column persona_brief jsonb,
  add column joins_meetings boolean not null default true,
  add constraint board_advisors_persona_brief_ck check (
    persona_brief is null or jsonb_typeof(persona_brief) = 'object'
  );

comment on column you.board_advisors.persona_brief is
  'What the person filled in on the People form: who, length, bubbles, tone, cares, never; Edit opens on it (plan #2748.11).';
comment on column you.board_advisors.joins_meetings is
  'Whether the board chair may seat them. A person added from Chat starts false and is in Chat only (plan #2748.11).';

create table you.advisor_persona_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  advisor_id uuid not null,
  persona text not null check (btrim(persona) <> '' and char_length(persona) <= 8000),
  made_by text not null default 'you',
  ask text check (ask is null or char_length(ask) <= 500),
  created_at timestamptz not null default now(),

  constraint advisor_persona_versions_made_by_ck check (made_by in ('you', 'dash')),
  foreign key (advisor_id, user_id)
    references you.board_advisors (id, user_id) on delete cascade
);

comment on table you.advisor_persona_versions is
  'Each persona card a mentor had before their current one, kept when a new card is saved so an earlier one can be brought back (plan #2748.11).';

create index advisor_persona_versions_advisor_idx
  on you.advisor_persona_versions (user_id, advisor_id, created_at desc);

alter table you.advisor_persona_versions enable row level security;

create policy advisor_persona_versions_all on you.advisor_persona_versions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on you.advisor_persona_versions from anon, authenticated;
grant select, insert on you.advisor_persona_versions to authenticated;
grant select, insert, update, delete on you.advisor_persona_versions to service_role;

notify pgrst, 'reload schema';

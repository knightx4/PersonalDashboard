-- What you did with a new track the flow offered you (plan #778).
--
-- When Practice Flow runs low on questions it offers a new track built from
-- the strongest theme in the vault map that you have no track for, as a card
-- with Start, Not now and Never (#776). This table is what each press leaves
-- behind, and it does two jobs:
--
--   1. It decides what is offered next. A theme you pressed Never on is not
--      offered again, one you pressed Not now on is held back for a few weeks,
--      and one you started already has a track.
--   2. It is the record plan #780 reads to learn which offered tracks you take
--      up and which you keep turning down.
--
-- As with `learn.next_outcomes`, nothing is written when a card is shown. A
-- row lands only when somebody presses one of the three buttons.
--
-- The theme is named twice, by id and by name, and neither is a foreign key.
-- The map belongs to the vault and Learn never writes to it (KNOWLEDGE-SPEC.md,
-- "Nothing crosses back"); Learn also has to outlive the vault being
-- disconnected, so a row here must not vanish with the theme. A later sweep
-- can merge or rename a theme and give it a new id, so a Never is matched by
-- either the id or the name, case-insensitively.

set search_path = learn, public, extensions;

create type learn.track_offer_outcome as enum (
  -- Start: the track was generated and written.
  'started',
  -- Not now: held back for a few weeks, then it may come round again.
  'not_now',
  -- Never: this theme is not offered again.
  'never'
);

create table learn.track_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- `obsidian.themes.id` when the offer was made. Deliberately no foreign key;
  -- see above.
  theme_id uuid not null,
  -- The theme's name when the offer was made. What a Never is matched on once
  -- the id has moved, and what a page can show without reading the vault.
  theme_name text not null,
  -- The theme's strength when the offer was made, so #780 can weigh what was
  -- taken up against how much of the vault it covered at the time.
  theme_strength numeric,

  outcome learn.track_offer_outcome not null,

  -- The track Start made. Null for Not now and Never, and set to null if the
  -- track is later deleted: the record of having started it stays.
  subject_id uuid,

  happened_at timestamptz not null default now(),

  constraint track_offers_name_ck check (theme_name <> ''),
  constraint track_offers_subject_ck check (outcome = 'started' or subject_id is null),
  constraint track_offers_subject_fk
    foreign key (subject_id, user_id) references learn.subjects (id, user_id)
    on delete set null (subject_id)
);

-- What the offer reads: everything this account has done with offers.
create index track_offers_user_idx on learn.track_offers (user_id, happened_at desc);
-- The index Postgres does not create for a foreign key.
create index track_offers_subject_idx on learn.track_offers (subject_id)
  where subject_id is not null;

comment on table learn.track_offers is
  'One row per press on a new-track offer in Practice Flow: started, not now, '
  'or never. Nothing records that an offer was shown.';

alter table learn.track_offers enable row level security;

create policy track_offers_all on learn.track_offers for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on learn.track_offers from anon;

-- Append-only for the app, like next_outcomes.
grant select, insert on learn.track_offers to authenticated;
grant select, insert, update, delete on learn.track_offers to service_role;

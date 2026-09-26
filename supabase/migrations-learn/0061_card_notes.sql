-- Notes on a Learn card (plan #1058).
--
-- You can write a note on any card in Learn now, or on an idea's own page
-- (/learn/c/[id]). A note written on a card is kept against the card and
-- against the idea the card teaches, so it shows on that card when it comes
-- back, on any other card for the same idea, and on the idea's page. A note
-- written on the idea's page has no card.
--
-- A table of its own rather than a column on feed_cards, so a card can carry
-- more than one note and a note outlives its card: a card is deleted with the
-- catalogue item it was cut from, and the note then stays on the idea. Both
-- links are `on delete set null` for that reason, and a note with neither
-- left is still yours and still found through the sources catalogue.
--
-- What the notes are later used for is a follow-on (feature #1051). They are
-- kept where Learn and Goals can read them.
--
-- Both links are composite foreign keys on (id, user_id), as readings' are
-- (0001), so a note cannot be pinned to another account's card or idea: a
-- plain foreign key is checked without RLS. feed_cards had no unique
-- (id, user_id) to point at, so one is added here.

set search_path = learn, public, extensions;

create unique index if not exists feed_cards_user_id_uq on learn.feed_cards (id, user_id);

create table if not exists learn.card_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- The card it was written on. Null when written on the idea's page, or
  -- once the card is gone.
  card_id uuid,
  -- The idea it is about: the card's concept when written on a card.
  concept_id uuid,

  body text not null,
  created_at timestamptz not null default now(),

  constraint card_notes_body_ck check (btrim(body) <> '' and length(body) <= 4000),
  constraint card_notes_card_fk foreign key (card_id, user_id)
    references learn.feed_cards (id, user_id) on delete set null (card_id),
  constraint card_notes_concept_fk foreign key (concept_id, user_id)
    references learn.concepts (id, user_id) on delete set null (concept_id)
);

-- What a card reads: the notes on it, and the notes on its idea.
create index if not exists card_notes_card_idx
  on learn.card_notes (card_id, created_at) where card_id is not null;
create index if not exists card_notes_concept_idx
  on learn.card_notes (concept_id, created_at) where concept_id is not null;
create index if not exists card_notes_user_idx on learn.card_notes (user_id, created_at);

alter table learn.card_notes enable row level security;

drop policy if exists card_notes_all on learn.card_notes;
create policy card_notes_all on learn.card_notes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on learn.card_notes to authenticated;
grant all on learn.card_notes to service_role;
revoke all on table learn.card_notes from anon;

comment on table learn.card_notes is
  'Notes the person wrote on a Learn now card or on an idea''s page (plan #1058). '
  'Kept against the card and its concept, so a note shows wherever the idea comes up again.';

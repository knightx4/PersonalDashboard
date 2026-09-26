-- Explaining a phrase selected on a Learn card, and making it a card
-- (plan #1057).
--
-- Select a phrase on a Learn now card, such as "tree search" on the AlphaGo
-- card, and Dash explains it in a few sentences: what it is and how it
-- connects to the card. The explanation is one Sonnet call, kept here against
-- the card and the phrase, so selecting the same phrase again reads it back
-- rather than paying twice. The underlined terms of plan #1056 open the same
-- row.
--
-- learn.phrase_explanations
--   card_id       the card the phrase was selected on. Deleted with it: the
--                 explanation is about the phrase as that card uses it.
--   phrase        the selection, whitespace flattened, at most 200 characters
--                 (MAX_SELECTION in lib/learn/graph/branch.ts). One row per
--                 phrase per card, whatever its case.
--   explanation   Dash's few sentences.
--   article       the English Wikipedia article that covers the phrase in
--                 the card's sense, named by the same call. Make it a card
--                 writes its card from that article. Null when the call
--                 named none.
--   section       the section of that article, or null for its lead.
--   made_card_id  the card Make it a card wrote, so a second press names it
--                 rather than writing another.
--
-- feed_cards gains a seventh reason, `asked`: a card written because the
-- person asked for one on a phrase. It is written from a Wikipedia section
-- like an interest or gap card, so it keeps item_id and segment_id.
--
--   asked_phrase  the phrase it was asked for, which the why line names.
--   asked_on      the title of the card the phrase was selected on.

set search_path = learn, public, extensions;

alter table learn.feed_cards
  add column if not exists asked_phrase text,
  add column if not exists asked_on text;

alter table learn.feed_cards
  drop constraint if exists feed_cards_reason_ck,
  drop constraint if exists feed_cards_target_ck;

alter table learn.feed_cards
  add constraint feed_cards_reason_ck
    check (reason in ('interest', 'gap', 'goal', 'queued', 'lesson', 'unit_check', 'asked')),
  add constraint feed_cards_target_ck check (
    case reason
      when 'interest' then theme_name is not null and btrim(theme_name) <> ''
      when 'gap' then field_id is not null
      when 'goal' then aim_name is not null and btrim(aim_name) <> ''
      when 'lesson' then track_name is not null and btrim(track_name) <> ''
                         and idea_name is not null and btrim(idea_name) <> ''
      when 'unit_check' then track_name is not null and btrim(track_name) <> ''
                             and unit_title is not null and btrim(unit_title) <> ''
      when 'asked' then asked_phrase is not null and btrim(asked_phrase) <> ''
      else reading_id is not null
    end
  );

create table if not exists learn.phrase_explanations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id uuid not null,
  phrase text not null,
  explanation text not null,
  article text,
  section text,
  model text not null,
  made_card_id uuid,
  created_at timestamptz not null default now(),

  constraint phrase_explanations_phrase_ck
    check (btrim(phrase) <> '' and length(phrase) <= 200),
  constraint phrase_explanations_explanation_ck
    check (btrim(explanation) <> '' and length(explanation) <= 4000),
  constraint phrase_explanations_card_fk foreign key (card_id, user_id)
    references learn.feed_cards (id, user_id) on delete cascade,
  constraint phrase_explanations_made_fk foreign key (made_card_id, user_id)
    references learn.feed_cards (id, user_id) on delete set null (made_card_id)
);

create unique index if not exists phrase_explanations_card_phrase_uq
  on learn.phrase_explanations (card_id, lower(phrase));
create index if not exists phrase_explanations_user_idx
  on learn.phrase_explanations (user_id, created_at);
create index if not exists phrase_explanations_made_idx
  on learn.phrase_explanations (made_card_id) where made_card_id is not null;

alter table learn.phrase_explanations enable row level security;

drop policy if exists phrase_explanations_all on learn.phrase_explanations;
create policy phrase_explanations_all on learn.phrase_explanations for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on learn.phrase_explanations to authenticated;
grant all on learn.phrase_explanations to service_role;
revoke all on table learn.phrase_explanations from anon;

comment on table learn.phrase_explanations is
  'Phrases the person selected on a Learn now card and Dash''s explanation of each (plan #1057). '
  'Kept so a second selection reads the explanation back rather than paying again.';

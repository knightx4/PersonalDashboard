-- The ideas a Learn now card mentions, underlined on the card (plan #1056).
--
-- The card writer names up to three other ideas a card leans on, such as
-- "tree search" on the AlphaGo card, each in words the card already uses and
-- with one line on why it matters to the card. The page underlines each one
-- where it first appears, and a tap opens the phrase explanation of plan
-- #1057 without selecting anything. A tapped term is kept as an ordinary
-- learn.phrase_explanations row.
--
-- learn.feed_cards
--   mentions  a JSON list of {"phrase": …, "why": …}, written by the same call
--             that writes the card, so it costs nothing more. Empty on every
--             card written before this, on lessons and on checks: those show
--             no underlines, and selecting a phrase still works on them.

set search_path = learn, public, extensions;

alter table learn.feed_cards
  add column if not exists mentions jsonb not null default '[]'::jsonb;

alter table learn.feed_cards
  drop constraint if exists feed_cards_mentions_ck;

alter table learn.feed_cards
  add constraint feed_cards_mentions_ck
    check (jsonb_typeof(mentions) = 'array' and jsonb_array_length(mentions) <= 3);

comment on column learn.feed_cards.mentions is
  'Other ideas the card leans on, as [{phrase, why}] in the card''s own words, underlined on the card (plan #1056).';

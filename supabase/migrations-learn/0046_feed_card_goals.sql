-- Learn now cards drawn for a learning goal (plan #900, under #895).
--
-- A fourth reason a card is there:
--
--   goal   an open-subject goal on the Goals page: aim_id and aim_name, with
--          the field the goal is placed in when it has one. A goal placed at
--          a whole domain, one that spans domains, and one not placed yet all
--          leave field_id null, and the card is drawn from the goal's own
--          wording.
--
-- The code calls goals aims (lib/learn/aims.ts), because `goals` already
-- means a concept typed into a track, so the column is aim_id.
--
-- The goal is kept by name as well as by id, as a theme is: the why line on a
-- card should still name what it was drawn for after the goal is deleted,
-- so the id goes null and the name stays. Archiving a goal keeps the row, so
-- the id stays too.

set search_path = learn, public, extensions;

alter table learn.feed_cards
  add column if not exists aim_id uuid references learn.aims (id) on delete set null,
  add column if not exists aim_name text;

alter table learn.feed_cards
  drop constraint if exists feed_cards_reason_ck,
  drop constraint if exists feed_cards_target_ck;

alter table learn.feed_cards
  add constraint feed_cards_reason_ck
    check (reason in ('interest', 'gap', 'goal', 'queued')),
  -- Every card names its target, by the rule for its reason.
  add constraint feed_cards_target_ck check (
    case reason
      when 'interest' then theme_name is not null and btrim(theme_name) <> ''
      when 'gap' then field_id is not null
      when 'goal' then aim_name is not null and btrim(aim_name) <> ''
      else reading_id is not null
    end
  );

-- The foreign key that a deleted goal sets null through.
create index if not exists feed_cards_aim_idx on learn.feed_cards (aim_id)
  where aim_id is not null;

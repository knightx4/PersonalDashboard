-- Explaining an idea back and having it marked (plan #1054).
--
-- Every so often the deck gives you an idea you kept at least three days ago
-- and asks you to explain it as if to a friend. Haiku marks what you wrote
-- against the idea's claim and basis: what was right, what was missing, and
-- whether you gave an example of your own. It asks one follow-up question in
-- the same saved conversation (core.conversations, plan #1053) and marks that
-- too. #1055 settled that this is the defence rung: an explanation that holds
-- and survives the follow-up marks the idea sharp.
--
-- feed_cards gains an eighth reason, `teach_back`. It is not written from a
-- Wikipedia section, so it carries no item or segment; its idea is concept_id.
--
--   teach_back  where the exchange has got to, as JSON. Empty until the
--               explanation is marked; then {"stage": "follow_up" | "done",
--               the marks, the follow-up question and the answer it expects,
--               "state": what the idea was left at}. The expected answer is
--               read on the server only. Each answer is also kept as a
--               learn.probes row at the defence rung, which is what the
--               idea's own page lists.
--
-- learn.settings, one row per person, for the Learn settings that are the
-- person's to change. The first is how often the deck asks for a
-- teach-back:
--
--   teach_back_every  one card in this many is a teach-back. 0 turns them off.
--                     No row reads as the default, one in ten.

set search_path = learn, public, extensions;

alter table learn.feed_cards
  add column if not exists teach_back jsonb;

alter table learn.feed_cards
  drop constraint if exists feed_cards_reason_ck,
  drop constraint if exists feed_cards_target_ck,
  drop constraint if exists feed_cards_material_ck,
  drop constraint if exists feed_cards_teach_back_ck;

alter table learn.feed_cards
  add constraint feed_cards_reason_ck
    check (reason in ('interest', 'gap', 'goal', 'queued', 'lesson', 'unit_check', 'asked', 'teach_back')),
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
      when 'teach_back' then concept_id is not null
                             and idea_name is not null and btrim(idea_name) <> ''
      else reading_id is not null
    end
  ),
  add constraint feed_cards_material_ck check (
    reason in ('queued', 'lesson', 'unit_check', 'teach_back')
    or (item_id is not null and segment_id is not null)
  ),
  add constraint feed_cards_teach_back_ck check (
    teach_back is null or (reason = 'teach_back' and jsonb_typeof(teach_back) = 'object')
  );

-- The draw looks for the last teach-back and for ideas already asked about.
create index if not exists feed_cards_teach_back_idx
  on learn.feed_cards (user_id, created_at desc) where reason = 'teach_back';

create table if not exists learn.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  teach_back_every smallint not null default 10,
  updated_at timestamptz not null default now(),

  constraint settings_teach_back_every_ck
    check (teach_back_every = 0 or teach_back_every between 2 and 100)
);

alter table learn.settings enable row level security;

drop policy if exists settings_all on learn.settings;
create policy settings_all on learn.settings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on learn.settings to authenticated;
grant all on learn.settings to service_role;
revoke all on table learn.settings from anon;

comment on table learn.settings is
  'The person''s Learn settings, one row each. teach_back_every: one Learn now card in this many '
  'asks you to explain an idea back (plan #1054); 0 is off, no row is one in ten.';
comment on column learn.feed_cards.teach_back is
  'A teach_back card''s exchange once marked: stage, marks, follow-up and the state it left the idea at (plan #1054).';

-- The cards behind Learn now.
--
-- docs/LEARN-NOW-SPEC.md, "How cards are made". A background pass picks what
-- each person should read next and pulls it from Wikipedia into the catalogue
-- (plan #806). Each thing it picks is one row here, pointing at the catalogue
-- segment it chose. A second pass (plan #807) reads the segment and writes the
-- summary and the "why" line onto the same row, or drops it when the section
-- turns out not to match. The page (plan #808) reads the ready rows, and what
-- the person does to a card is recorded on it (plan #809).
--
-- A row moves through these statuses:
--
--   picked     named by the model, fetched, and stored in the catalogue. No
--              summary yet.
--   ready      the summary and the why line are written. The feed shows it.
--   dropped    the writer found the section does not match the target, or it
--              could not be written. Kept, so the same section is not picked
--              again for this person.
--   opened     the person followed the link to the source.
--   saved      the person saved it to a reading list.
--   dismissed  the person pressed Not interested.
--
-- Three reasons a card is there, and each names its target:
--
--   interest   a theme the person writes about: theme_id and theme_name, with
--              the field the theme is placed in.
--   gap        a field the person has never been tested in, or has nothing in
--              at all: field_id.
--   queued     a reading the person queued themselves: reading_id.
--
-- The theme is kept by name as well as by id. A vault sweep renames and merges
-- themes, and a card picked for a theme that has since gone should still say
-- why it was picked, so the id goes null and the name stays.

set search_path = learn, public, extensions;

create table if not exists learn.feed_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  reason text not null,
  theme_id uuid,
  theme_name text,
  field_id uuid references learn.area_fields (id) on delete restrict,
  reading_id uuid references learn.readings (id) on delete cascade,

  -- What was picked. Null only for a queued reading, which points at the
  -- reading instead.
  item_id uuid references learn.catalogue_items (id) on delete cascade,
  segment_id uuid references learn.catalogue_segments (id) on delete cascade,
  -- The article and section as the model named them, before they were
  -- matched to the stored article. Kept to show what was asked for when the
  -- match fell back to the article's lead.
  named_article text,
  named_section text,
  -- The model's one sentence on why this section suits the target.
  pick_basis text,
  pick_model text,

  status text not null default 'picked',

  -- Written by plan #807.
  summary text,
  why text,
  write_model text,
  written_at timestamptz,

  -- When the person last did something to it: opened, saved, dismissed.
  acted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint feed_cards_theme_fk
    foreign key (theme_id, user_id) references obsidian.themes (id, user_id)
    on delete set null (theme_id),
  constraint feed_cards_reason_ck check (reason in ('interest', 'gap', 'queued')),
  constraint feed_cards_status_ck
    check (status in ('picked', 'ready', 'dropped', 'opened', 'saved', 'dismissed')),
  -- Every card names its target, by the rule for its reason.
  constraint feed_cards_target_ck check (
    case reason
      when 'interest' then theme_name is not null and btrim(theme_name) <> ''
      when 'gap' then field_id is not null
      else reading_id is not null
    end
  ),
  -- A picked card points at a stored section; a queued one at a reading.
  constraint feed_cards_material_ck check (
    reason = 'queued' or (item_id is not null and segment_id is not null)
  ),
  -- A card is only shown once it has a summary to show.
  constraint feed_cards_ready_ck check (
    status in ('picked', 'dropped') or reason = 'queued' or summary is not null
  ),
  -- One card per section per person, so a section is never picked twice.
  constraint feed_cards_segment_uq unique (user_id, segment_id)
);

-- What the page and the writer read: one person's cards by status, newest first.
create index if not exists feed_cards_user_status_idx
  on learn.feed_cards (user_id, status, created_at desc);
-- What the pass reads to skip targets picked recently.
create index if not exists feed_cards_user_theme_idx
  on learn.feed_cards (user_id, theme_id, created_at desc)
  where theme_id is not null;
create index if not exists feed_cards_user_field_idx
  on learn.feed_cards (user_id, field_id, created_at desc)
  where field_id is not null;
-- Foreign keys that delete cascades through.
create index if not exists feed_cards_item_idx on learn.feed_cards (item_id);
create index if not exists feed_cards_segment_idx on learn.feed_cards (segment_id);
create index if not exists feed_cards_reading_idx on learn.feed_cards (reading_id)
  where reading_id is not null;

drop trigger if exists feed_cards_touch_updated_at on learn.feed_cards;
create trigger feed_cards_touch_updated_at
  before update on learn.feed_cards
  for each row execute function learn.touch_updated_at();

alter table learn.feed_cards enable row level security;

drop policy if exists feed_cards_select on learn.feed_cards;
create policy feed_cards_select on learn.feed_cards for select to authenticated
  using (user_id = (select auth.uid()));
-- Update is how Save, Not interested and opening the source are recorded. The
-- passes that pick and write cards run as the service role and need no policy.
drop policy if exists feed_cards_update on learn.feed_cards;
create policy feed_cards_update on learn.feed_cards for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, update on learn.feed_cards to authenticated;
grant all on learn.feed_cards to service_role;
revoke all on table learn.feed_cards from anon;

-- What each field has been tested on, for one person.
--
-- The gap draw needs to know which fields have an answered question behind
-- them. The Know page works that out from every track's graph, which is more
-- than a background pass should load. This is the same count in one query: the
-- tracks placed in each field and how many of their ideas have been tested.
-- Service role only, because it takes the person as an argument.
create or replace function learn.feed_field_tests(p_user_id uuid)
returns table (field_id uuid, tracks integer, answered integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.field_id,
         count(distinct s.id)::integer as tracks,
         count(cs.concept_id) filter (where cs.tested_at is not null)::integer as answered
    from learn.subjects s
    left join learn.concepts c on c.subject_id = s.id
    left join learn.concept_state cs on cs.concept_id = c.id and cs.user_id = s.user_id
   where s.user_id = p_user_id
     and s.field_id is not null
     and s.placed_at is not null
   group by s.field_id
$$;

revoke all on function learn.feed_field_tests(uuid) from public, anon, authenticated;
grant execute on function learn.feed_field_tests(uuid) to service_role;

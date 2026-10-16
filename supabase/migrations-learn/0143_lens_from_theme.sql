-- A lens made from a vault theme (plan #2138.14, docs/LEARN-LEVELS-SPEC.md,
-- "Lenses: subjects and goals").
--
-- When a practice run misses levels on topics tied to a vault theme that no
-- lens covers, the end of the run offers one press that makes a lens of those
-- topics at the levels missed. This adds the third kind of lens and the memory
-- of a declined offer.
--
--   lenses.origin   gains 'theme'.
--   lenses.theme_id the theme the lens was made from. The theme going away
--                   (a merge, a delete) leaves the lens, with no theme.
--   lens_offer_declines
--                   one row per theme the person said no to, so it is not
--                   offered again. Bookkeeping; the theme going takes it.

set search_path = learn, public, extensions;

alter table learn.lenses drop constraint if exists lenses_origin_ck;
alter table learn.lenses
  add constraint lenses_origin_ck check (origin in ('subject', 'goal', 'theme'));

alter table learn.lenses add column if not exists theme_id uuid;

alter table learn.lenses
  add constraint lenses_theme_fk foreign key (theme_id, user_id)
    references obsidian.themes (id, user_id) on delete set null (theme_id);

alter table learn.lenses
  add constraint lenses_theme_ck check (theme_id is null or origin = 'theme');

create unique index if not exists lenses_theme_uq on learn.lenses (theme_id) where theme_id is not null;

comment on column learn.lenses.theme_id is
  'The vault theme this lens was made from (plan #2138.14). Set only when origin is theme and the theme still exists.';

create table if not exists learn.lens_offer_declines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  theme_id uuid not null,
  declined_at timestamptz not null default now(),

  constraint lens_offer_declines_theme_fk
    foreign key (theme_id, user_id) references obsidian.themes (id, user_id) on delete cascade,
  constraint lens_offer_declines_uq unique (user_id, theme_id)
);

alter table learn.lens_offer_declines enable row level security;

create policy lens_offer_declines_all on learn.lens_offer_declines for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update, delete on learn.lens_offer_declines to authenticated;

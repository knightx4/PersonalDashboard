-- Figures on a lesson (plan #2321.1).
--
--   feed_cards.figures
--       The figures the lesson writer drew for the idea, in order, each
--       {kind, caption, spec}. kind names an entry in the figure registry
--       (lib/learn/figures/registry.ts); spec is that kind's own shape, read
--       with its schema when the lesson is drawn. A block of a kind the app
--       no longer knows, or whose spec no longer parses, shows its caption
--       alone. An empty array, the default, is a lesson with no figure, which
--       is every card written before this file and every card that is not a
--       lesson.

set search_path = learn, public, extensions;

alter table learn.feed_cards add column if not exists figures jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'feed_cards_figures_array_ck' and conrelid = 'learn.feed_cards'::regclass
  ) then
    alter table learn.feed_cards
      add constraint feed_cards_figures_array_ck check (jsonb_typeof(figures) = 'array');
  end if;
end $$;

comment on column learn.feed_cards.figures is
  'The lesson''s figures, each {kind, caption, spec}, kind from the figure registry (plan #2321.1). Empty for no figure.';

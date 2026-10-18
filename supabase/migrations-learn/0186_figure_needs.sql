-- What lessons asked to show and the app could not draw (plan #2321.9).
--
--   learn.figure_needs
--       One row per wanted block a lesson stored: a figure the lesson writer
--       said the idea needs and no registered kind can draw. need is what
--       kind of thing is missing (a figure kind, a data source, a model, a
--       map layer); shows and why are the writer's own lines, what the
--       figure would show and why prose is worse; caption is the block's.
--       card_id is the lesson (learn.feed_cards) and ordinal the block's
--       place in its figures, so a lesson's block is recorded once.
--
--       key groups the rows that ask for the same thing. The first row of a
--       group takes its own id as its key; a later row whose description
--       embeds close to an earlier one of the same need takes that row's key
--       (lib/learn/figures/needs.ts). embedding is the description embedded
--       as a document, null when no embedding could be made, and then only
--       an identical description joins a group.
--
--   learn.figure_need_groups
--       One row per key: the need as its first row described it, how many
--       lessons have asked (asked), and the lessons and subjects asking. The
--       count rises as lessons ask again. Read with the asker's own rights.
--
-- Bookkeeping, not a source: what the person wrote is the lesson itself.

set search_path = learn, public, extensions;

create table if not exists learn.figure_needs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject_id uuid references learn.subjects (id) on delete cascade,
  card_id uuid not null references learn.feed_cards (id) on delete cascade,
  ordinal integer not null default 0 check (ordinal >= 0),
  need text not null check (need in ('figure_kind', 'data_source', 'model', 'map_layer')),
  shows text not null check (length(shows) between 1 and 400),
  why text not null check (length(why) between 1 and 400),
  caption text not null check (length(caption) between 1 and 400),
  key uuid not null,
  embedding extensions.vector(1024),
  embedding_model text,
  created_at timestamptz not null default now(),
  constraint figure_needs_card_ordinal_key unique (card_id, ordinal)
);

create index if not exists figure_needs_user_need_idx on learn.figure_needs (user_id, need, created_at);
create index if not exists figure_needs_key_idx on learn.figure_needs (key);
create index if not exists figure_needs_subject_idx on learn.figure_needs (subject_id);

comment on table learn.figure_needs is
  'Figures lessons asked for that no registered kind can draw, one row per wanted block, grouped by key (plan #2321.9).';
comment on column learn.figure_needs.key is
  'Groups the rows asking for the same thing: the id of the group''s first row (lib/learn/figures/needs.ts).';
comment on column learn.figure_needs.need is
  'What is missing: figure_kind, data_source, model or map_layer.';

alter table learn.figure_needs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'learn' and tablename = 'figure_needs' and policyname = 'figure_needs_read'
  ) then
    create policy figure_needs_read on learn.figure_needs for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end;
$$;

grant select on learn.figure_needs to authenticated;
grant select, insert, update, delete on learn.figure_needs to service_role;
revoke all on table learn.figure_needs from anon;

create or replace view learn.figure_need_groups
with (security_invoker = on) as
select
  n.user_id,
  n.key,
  first.need,
  first.shows,
  first.why,
  first.caption,
  count(*)::integer as asked,
  array_agg(distinct n.card_id) as card_ids,
  array_agg(distinct n.subject_id) filter (where n.subject_id is not null) as subject_ids,
  min(n.created_at) as first_asked_at,
  max(n.created_at) as last_asked_at
from learn.figure_needs n
join learn.figure_needs first on first.id = n.key
group by n.user_id, n.key, first.need, first.shows, first.why, first.caption;

comment on view learn.figure_need_groups is
  'One row per grouped figure need, with how many lessons asked (plan #2321.9).';

grant select on learn.figure_need_groups to authenticated, service_role;
revoke all on learn.figure_need_groups from anon;

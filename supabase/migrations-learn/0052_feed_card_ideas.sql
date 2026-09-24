-- One idea per Learn now card (LEARN-NOW-SPEC, "One idea per card").
--
-- The card writer used to turn one Wikipedia section into one card, so a
-- section holding four loose points became one card summarising all four. It
-- now lists the section's ideas, at most three, and writes a card for each in
-- the same call. Each idea is also kept as a concept, so the swipes on its card
-- say what the person knows idea by idea rather than section by section.
--
-- feed_cards
--   idea_name   the idea's short name, the card's title. Null on cards written
--               before this, which keep the "Article: Section" title.
--   idea_index  which of the section's ideas the card is, from 0. The picked
--               row becomes idea 0 and the rest get rows of their own, so the
--               one-card-per-section key becomes one card per idea.
--   concept_id  the concept the idea was saved as. Null on older cards, and on
--               a card whose concept could not be saved: the card still shows.
--
-- concepts
--   embedding, embedding_model  the claim embedded with Voyage, the same space
--               and width as learn.catalogue_segments.embedding, so the ideas
--               already held nearest a section can be found before its cards
--               are written, and a new claim that is an old one reworded can
--               be caught after.
--
-- concept_origin gains 'feed' for ideas taken from a Learn now card. Nothing in
-- this file uses the new value, which Postgres refuses inside the transaction
-- that adds it.

set search_path = learn, public, extensions;

alter type learn.concept_origin add value if not exists 'feed';

alter table learn.feed_cards add column if not exists idea_name text;
alter table learn.feed_cards add column if not exists idea_index smallint not null default 0;
alter table learn.feed_cards
  add column if not exists concept_id uuid references learn.concepts (id) on delete set null;

alter table learn.feed_cards drop constraint if exists feed_cards_idea_index_ck;
alter table learn.feed_cards add constraint feed_cards_idea_index_ck
  check (idea_index between 0 and 9);

alter table learn.feed_cards drop constraint if exists feed_cards_segment_uq;
alter table learn.feed_cards drop constraint if exists feed_cards_segment_idea_uq;
alter table learn.feed_cards add constraint feed_cards_segment_idea_uq
  unique (user_id, segment_id, idea_index);

create index if not exists feed_cards_concept_idx on learn.feed_cards (concept_id)
  where concept_id is not null;

alter table learn.concepts add column if not exists embedding extensions.vector(1024);
alter table learn.concepts add column if not exists embedding_model text;

-- The ideas one person holds nearest a vector, closest first.
--
-- Takes the person's id because the top-up calls it with the service role,
-- which RLS does not narrow. Called through the person's own session it still
-- returns only their rows, since it runs as the caller. No vector index: one
-- person holds hundreds of concepts at most, and a scan of those is quicker
-- than keeping an index up to date.
create or replace function learn.nearest_concepts(
  for_user uuid,
  query_embedding text,
  match_limit int default 10,
  min_similarity double precision default 0.3
)
returns table (
  concept_id uuid,
  name text,
  claim text,
  state learn.knowledge_state,
  similarity double precision
)
language sql
stable
security invoker
set search_path = learn, extensions, pg_temp
as $$
  select c.id,
         c.name,
         c.claim,
         coalesce(s.state, 'unknown'::learn.knowledge_state),
         (1 - (c.embedding <=> query_embedding::extensions.vector))::double precision as similarity
    from learn.concepts c
    left join learn.concept_state s on s.concept_id = c.id
   where c.user_id = for_user
     and c.embedding is not null
     and 1 - (c.embedding <=> query_embedding::extensions.vector) >= coalesce(min_similarity, 0.3)
   order by c.embedding <=> query_embedding::extensions.vector, c.id
   limit least(greatest(coalesce(match_limit, 10), 1), 50)
$$;

comment on function learn.nearest_concepts(uuid, text, int, double precision) is
  'One person''s concepts nearest a query vector by cosine similarity, closest first.';

revoke all on function learn.nearest_concepts(uuid, text, int, double precision)
  from public, anon;
grant execute on function learn.nearest_concepts(uuid, text, int, double precision)
  to authenticated, service_role;

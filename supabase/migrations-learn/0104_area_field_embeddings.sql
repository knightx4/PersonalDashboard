-- A vector for each field of the area catalogue (plan #1856).
--
-- The Idea Space map places the 47 fields among the ideas, and a domain at the
-- average of its fields. A field is embedded from its name and scope, once: the
-- fields change only by migration, so a row needs a new vector only when its
-- text or the embedding model changes. The daily sweep fills them; the same
-- 1,024 dimensions and cosine space as learn.concepts.embedding, so a field
-- and an idea are comparable.
--
-- No index: 47 rows. embedding_model names what made the vector, null while
-- there is none.
alter table learn.area_fields add column if not exists embedding extensions.vector(1024);
alter table learn.area_fields add column if not exists embedding_model text;

alter table learn.area_fields drop constraint if exists area_fields_embedding_ck;
alter table learn.area_fields add constraint area_fields_embedding_ck
  check ((embedding is null) = (embedding_model is null));

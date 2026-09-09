-- The generated prep note, beside the one you typed.
--
-- `interviews.prep_notes` is a textarea on the role's Interviews tab: whatever
-- you wrote for yourself before the round. The prep note the app generates is
-- a different thing with a different owner, and writing it into that field
-- would either overwrite what you typed or leave one box half yours and half
-- the machine's, with no way to regenerate the second half without destroying
-- the first. So it gets its own columns and `prep_notes` is not touched.
--
-- It hangs off the interview rather than off `interview_groups`, because every
-- conversation has an interview row and not every round has a group row -- a
-- single-conversation round often has none. A superday generates once for the
-- round and shows that one note on each of its conversations, which is what
-- the Interviews page already does with the debrief.
--
-- `prep_note_key` is the same staleness device as `roles.requirement_matches_key`
-- (0015): a fingerprint of the facts the note was written against, so pressing
-- the button again is a no-op until one of them changes and a note whose key no
-- longer matches can say out loud that it is stale. Without it, a page that
-- offers to regenerate is a page that bills a model call per visit.
--
-- Nullable, no backfill, no default: a round has no prep note until one is
-- generated, and null is exactly that. RLS is the table's own -- the policies
-- in 0004 are row-level and cover every column -- so no policy changes here,
-- and the grants are table-level too.

set search_path = job_search, extensions;

alter table interviews
  -- The note's sections, as the model returned them and the card renders them:
  -- who you are meeting, strengths and gaps, stories to have ready, questions
  -- to ask, and what it could not find. `jsonb` rather than text for the same
  -- reason `roles.requirement_matches` is jsonb -- the note is read section by
  -- section, and a blob of JSON inside a text column is a jsonb column that
  -- has to be parsed by hand at every read.
  add column if not exists prep_note jsonb,
  add column if not exists prep_note_at timestamptz,
  -- sha1 over the facts the note was written against; see 0015 for the pattern.
  add column if not exists prep_note_key text;

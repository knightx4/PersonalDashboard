-- Two more states a concept can be in: recognised, and sharp.
--
-- Plan #401, under #386. Getting the multiple-choice question right has meant
-- known, and that is the gap the ladder exists to close: recognising an idea in
-- a list of four is not using it. So a right multiple-choice answer now writes
-- `recognised`, a right applied answer writes `known`, and `sharp` waits for the
-- defence rung to write it. #392 settled that the middle state exists at all
-- rather than the ladder showing on one page: an idea that has only been
-- recognised reads that way on the subject view, the graph and everywhere else
-- the state is named.
--
-- Placed either side of `known` so the enum reads in order of how much has been
-- shown. Nothing orders by this column today, but a value appended at the end
-- would be a trap for whatever does first.
--
-- The rows already written are moved in 0019 rather than here: Postgres refuses
-- to use a new enum value in the transaction that added it, so the backfill
-- cannot be in this file.

set search_path = learn, public, extensions;

alter type learn.knowledge_state add value if not exists 'recognised' after 'shaky';
alter type learn.knowledge_state add value if not exists 'sharp' after 'known';

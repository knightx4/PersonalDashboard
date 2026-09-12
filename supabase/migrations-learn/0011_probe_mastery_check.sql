-- Which check of understanding a question was written against.
--
-- A concept carries two to four checks saying what having it looks like, and a
-- question is aimed at one of them rather than at the claim in general. This
-- is where the aim is recorded, so a concept's page can say which of its checks
-- have been asked about and the next question can go somewhere new.
--
-- The text itself, not an index into learn.concepts.mastery, for the same
-- reason `options` is stored verbatim: the checks can be rewritten, and an
-- index into a list that has since changed points at the wrong sentence
-- without ever looking wrong.
--
-- Nullable. A question asked before the checks existed has none, and so does
-- every question about a concept whose checks were never written -- that
-- concept is probed exactly as it was before.

alter table learn.probes
  add column if not exists mastery_check text;

-- Null or a real sentence. An empty string here would read as "no check" in
-- the database and as "a check" everywhere else.
alter table learn.probes
  add constraint probes_mastery_check_ck
  check (mastery_check is null or mastery_check <> '');

comment on column learn.probes.mastery_check is
  'The check of understanding this question was written against, stored as the '
  'text it was at the time. Null for a question about a concept with no checks.';

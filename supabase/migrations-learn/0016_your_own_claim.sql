-- Somewhere to keep the app's wording when you rewrite a claim.
--
-- Every claim in the graph was written by the model that proposed the concept,
-- and plan #381 lets you replace any of them with your own sentence. The
-- rewrite happens in place, in `claim`, so the probe writer, the concept page
-- and the subject page all pick up the new wording without being changed. That
-- is the cheap half. The half that needs columns is being able to say
-- afterwards whose words you are reading, and to get back to the ones you
-- replaced.
--
-- Two columns, and they are one fact between them: what the claim said before
-- you first rewrote it, and when you last rewrote it. Both null on every row
-- that exists today, which reads as never rewritten -- the same way a concept
-- written before `kind` existed says neither door nor consequence rather than
-- being defaulted into one.
--
-- The original is kept from the *first* rewrite only. What the app wrote is the
-- thing worth being able to go back to; the sentence you wrote last Tuesday and
-- then improved is a draft of your own, and keeping every one of them would
-- turn a line on the concept page into a revision history nobody asked for.
-- Plan #382 settled what happens to the questions already asked: they keep
-- their answers and the page marks the ones written before the last rewrite, by
-- comparing `created_at` on the probe with `claim_rewritten_at` here. No write
-- is needed for that, which is why nothing below touches learn.probes.

set search_path = learn, public, extensions;

alter table learn.concepts
  add column if not exists claim_original text,
  add column if not exists claim_rewritten_at timestamptz;

comment on column learn.concepts.claim_original is
  'What `claim` said before the first time you rewrote it. Null on a claim you '
  'have never rewritten, and untouched by every rewrite after the first.';
comment on column learn.concepts.claim_rewritten_at is
  'When you last wrote this claim yourself. Null means the wording is still the '
  'one the app proposed.';

-- The two halves of one fact: a kept original with no date is a sentence
-- nobody can place, and a date with no original is a claim that says it was
-- rewritten and cannot show what from. A blank original is neither.
alter table learn.concepts
  add constraint concepts_rewritten_ck check (
    (claim_original is null) = (claim_rewritten_at is null)
    and (claim_original is null or claim_original <> '')
  );

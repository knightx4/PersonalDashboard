-- Who wrote which words of the draft (plan #1868, under #1863;
-- docs/LEARN-ESSAYS-SPEC.md, "Who wrote what").
--
-- learn.essays.authorship holds the ranges as the vault note has them:
-- graphemes from the start of the file, frontmatter included, written only
-- when the note is saved to the vault. The draft is saved as you type and
-- is often ahead of the note, so the marks on it need a place of their own,
-- or a rephrase accepted and then left unsaved to the vault would come back
-- marked as yours.
--
-- learn.essays.draft_authorship: the text in draft_body that is not the
-- person's, as [{ "author": "dash" | "quote", "start", "length", "name" }].
-- Offsets are UTF-16 code units of draft_body, as the editor counts them;
-- name is the model for Dash's text and the source for a quote. Everything
-- outside these ranges is the person's.

alter table learn.essays
  add column if not exists draft_authorship jsonb not null default '[]'::jsonb;

alter table learn.essays drop constraint if exists essays_draft_authorship_array;
alter table learn.essays add constraint essays_draft_authorship_array
  check (jsonb_typeof(draft_authorship) = 'array');

comment on column learn.essays.draft_authorship is
  'Ranges of draft_body that are Dash''s or quoted, as [{author, start, length, name}] in UTF-16 units of the draft (plan #1868).';

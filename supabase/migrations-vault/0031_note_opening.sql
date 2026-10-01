-- A short opening of each note, for the note list (plan #1377, under #1376).
--
-- The Vault page, the column beside an open note and the list that slides in
-- on a phone show every note with a one-line excerpt. Until now the list read
-- each note's whole body to cut that excerpt, which is about 6 MB across a
-- vault of 1,300 notes, so it stopped at 500. This column holds the first 400
-- characters of the body, and the list reads it instead of the body: about
-- 0.4 MB for the same vault.
--
-- Runs of spaces and tabs are collapsed to one space before the cut. The
-- excerpt collapses them anyway, and a note that opens with a padded Markdown
-- table spends hundreds of characters on alignment: one such note in the live
-- vault had 34 characters of text in its first 400. Newlines are kept, because
-- the excerpt strips a heading's leading `#` by finding it at the start of a
-- line. With this, every excerpt in the live vault on 1 October 2026 came out
-- the same from the opening as from the whole body.
--
-- Stored and generated, as search_tsv is, so the sync writes nothing new and
-- the column is read like any other.

alter table obsidian.notes
  add column opening text
  generated always as (
    left(regexp_replace(coalesce(body, ''), '[ \t]+', ' ', 'g'), 400)
  ) stored;

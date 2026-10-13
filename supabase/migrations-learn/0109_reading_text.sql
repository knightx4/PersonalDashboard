-- The text of a reading, given by you (plan #1876.1).
--
-- A reading Dash cannot open from its link (a paywall, a book, a page that
-- blocks fetching) can carry the text itself, pasted or read out of a PDF.
-- It is kept on the reading as three nullable columns rather than a new table:
--
--   given_text        the text, at most 200,000 characters.
--   given_text_label  where it came from: 'Pasted', or the PDF's file name.
--   given_text_at     when it was added.
--
-- All three are set together or all three are null. A reading with text never
-- has its link fetched for a summary or a chat.

alter table learn.readings
  add column if not exists given_text text,
  add column if not exists given_text_label text,
  add column if not exists given_text_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'readings_given_text_check'
  ) then
    alter table learn.readings
      add constraint readings_given_text_check check (
        (given_text is null and given_text_label is null and given_text_at is null)
        or (
          given_text is not null and given_text_label is not null and given_text_at is not null
          and char_length(given_text) between 1 and 200000
        )
      );
  end if;
end;
$$;

comment on column learn.readings.given_text is
  'The reading''s text as you gave it, pasted or read from a PDF; used instead of the link (plan #1876.1).';

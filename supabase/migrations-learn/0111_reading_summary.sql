-- A reading's summary, written by Dash on the Summarize button (plan #1876.4).
--
-- One summary per reading, kept on the reading so it shows again on later
-- visits; Redo writes over it. Five nullable columns rather than a new table:
--
--   summary            the summary Dash wrote.
--   summary_at         when it was written.
--   summary_from       'given' when it was written from text you gave the
--                      reading, 'link' when from the page at its link.
--   summary_label      that text's label ('Pasted', a PDF's file name) or the
--                      address the page was read from.
--   summary_truncated  true when the reading was longer than the 200,000
--                      characters Dash read, so the summary covers the start.
--
-- All five are set together or all are null.

alter table learn.readings
  add column if not exists summary text,
  add column if not exists summary_at timestamptz,
  add column if not exists summary_from text,
  add column if not exists summary_label text,
  add column if not exists summary_truncated boolean;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'readings_summary_check'
  ) then
    alter table learn.readings
      add constraint readings_summary_check check (
        (summary is null and summary_at is null and summary_from is null
          and summary_label is null and summary_truncated is null)
        or (
          summary is not null and summary_at is not null and summary_label is not null
          and summary_truncated is not null
          and summary_from in ('given', 'link')
          and char_length(summary) between 1 and 20000
        )
      );
  end if;
end;
$$;

comment on column learn.readings.summary is
  'Dash''s summary of the reading, from the Summarize button; Redo replaces it (plan #1876.4).';

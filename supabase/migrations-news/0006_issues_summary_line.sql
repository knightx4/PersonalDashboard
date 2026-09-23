-- A one-line summary of each issue, kept beside its summary.
--
-- Planned as #824, under #822. #823 chose a separate line written by Haiku in
-- the same call as the summary, for the newsletter list to show under the
-- subject and sender. lib/news/issues/digest.ts writes it; #825 shows it.
--
-- It is written with the summary and cleared with it: a failed attempt stores
-- neither. It can be null beside a summary, for an issue summarised before
-- this column existed or a reply that left the line out.
--
-- Nothing is backfilled here. The issues already summarised are redone by the
-- catch-up once their digested_at is cleared, and that clear is run by hand
-- after the code that writes this column is deployed. Clearing it before then
-- would have the deployed catch-up redo them without the line.
--
-- Row level security on news.issues is a policy over the whole row
-- (`issues_all` in 0001), so it covers this column and no policy changes.

alter table news.issues
  add column summary_line text,

  add constraint issues_summary_line_ck check (
    summary_line is null or (btrim(summary_line) <> '' and summary is not null)
  );

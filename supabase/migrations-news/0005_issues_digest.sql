-- A summary of each issue and the stories in it, kept with the issue.
--
-- Planned as #785, under #782. #784 settled that an issue is summarised when it
-- arrives, so the summary is written once and read on every open, and these
-- columns are where it is kept. #786 writes them; #788 shows them.
--
-- stories is a jsonb array, one object per story:
--   {"headline": "...", "summary": "...", "link": "https://..."}
-- headline and summary are always present. link is present only when the
-- email gave the story one (#783 chose headline, two sentences and the link),
-- and it is the address from the email, not one the model wrote (#803). An
-- issue that is one long essay has the summary and an empty array.
--
-- digested_at is when the last attempt finished, whether it wrote a summary or
-- an error. A catch-up run looks for `digested_at is null`, so an issue the
-- model could not read is not retried on every run; clearing digested_at
-- queues it again.
--
-- Nothing is backfilled here. The issues already stored stay null until
-- #787's catch-up script summarises them.
--
-- Row level security on news.issues is a policy over the whole row
-- (`issues_all` in 0001), so it covers these columns and no policy changes.

alter table news.issues
  -- A few sentences on the whole issue, or null while it has not been
  -- summarised or when the attempt failed.
  add column summary text,
  -- The stories in the issue, in the order the email gave them. Null exactly
  -- when summary is null.
  add column stories jsonb,
  -- When the last summary attempt finished, successful or not.
  add column digested_at timestamptz,
  -- Why the last attempt wrote no summary, or null when it did or none has
  -- run. Shown on the reading page in place of the summary.
  add column digest_error text,

  add constraint issues_summary_ck check (summary is null or btrim(summary) <> ''),
  add constraint issues_stories_ck check (
    (summary is null and stories is null)
    or (summary is not null and jsonb_typeof(stories) = 'array')
  ),
  add constraint issues_digest_error_ck check (digest_error is null or btrim(digest_error) <> ''),
  -- An attempt either wrote a summary or an error, and says when it finished.
  add constraint issues_digest_ck check (
    num_nonnulls(summary, digest_error) <= 1
    and (num_nonnulls(summary, digest_error) = 0 or digested_at is not null)
  );

-- The requirement match: your evidence beside each line of the job description.
--
-- `roles.requirements` already holds the extracted lines. This holds the join
-- of those lines to `evidence_items` -- for each requirement, the best item you
-- have, a verdict of strong, partial or gap, and one line saying why.
--
-- Stored on the role rather than computed on read because it costs a model
-- call. The key is what makes that safe: it is a hash of the description the
-- match was computed against plus a fingerprint of the bank at the time, so a
-- match re-runs exactly when one of those two changes and stays put otherwise.
-- Without it a page view would fire a model call, which is how a feature that
-- costs eight cents becomes a feature that costs eight cents per refresh.

set search_path = job_search, extensions;

begin;

alter table roles
  -- [{ requirement, kind, verdict, evidence_item_id, why }]
  add column if not exists requirement_matches jsonb,
  add column if not exists requirement_matches_at timestamptz,
  -- sha1(jd_hash + bank fingerprint); see matchKey() in lib/jobs/evidence/match-payload.ts
  add column if not exists requirement_matches_key text;

-- No index accompanies this. EVIDENCE-LAYER.md asks for a gin trigram index on
-- `evidence_items.title` to support a SQL shortlist, but the shortlist is in
-- lib/jobs/evidence/shortlist.ts instead: at bank size the whole bank is read
-- for the match anyway, ranking it in TypeScript is unit-testable where a
-- `similarity()` query would need a definer function to reach through
-- PostgREST, and an index nothing queries is the dead weight this schema is
-- careful not to accumulate. Revisit together with pgvector, past ~200 items.

commit;

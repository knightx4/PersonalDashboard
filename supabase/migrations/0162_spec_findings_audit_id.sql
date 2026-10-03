-- Which audit wrote a finding (plan #1522, docs/SPEC-LAYER-SPEC.md part 2).
--
-- The weekly spec audit writes many spec_findings rows in one run, one or
-- more per spec. A spec's page in Dev shows what the latest audit found
-- (plan #1525), so the rows of one run need something in common that a later
-- run's rows do not share. Each run generates one audit_id and stamps it on
-- every finding it writes, the way vision_reviews.review_id groups a vision
-- review (0108).
--
-- Nullable: a finding written outside an audit, such as the notes routine's
-- missing_rule finding (plan #1526), belongs to no run.

alter table public.spec_findings add column if not exists audit_id uuid;

-- The newest audit's findings for a spec, and every finding of one run.
create index if not exists spec_findings_user_audit_idx
  on public.spec_findings (user_id, audit_id, spec)
  where audit_id is not null;

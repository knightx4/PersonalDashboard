-- Why a piece of a plan was passed (plan #2292.2).
--
--   plan_pieces.passed_reason
--       'check' when the piece's own check passed it, from the piece's page;
--       'placement' when a placement run, before the first lesson, showed
--       every cell the piece teaches as held. Null on a piece not passed,
--       and on one passed before this column, which was always by its check.
--
-- No existing row is rewritten: a passed piece with no reason reads as passed
-- by its check.

set search_path = learn, public, extensions;

alter table learn.plan_pieces add column if not exists passed_reason text;

alter table learn.plan_pieces drop constraint if exists plan_pieces_passed_reason_ck;
alter table learn.plan_pieces
  add constraint plan_pieces_passed_reason_ck
    check (
      passed_reason is null
      or (passed_reason in ('check', 'placement') and passed_at is not null)
    );

comment on column learn.plan_pieces.passed_reason is
  'Why the piece was passed: check (its own check) or placement (a placement run showed every cell it teaches held). Null when not passed, or passed before plan #2292.2.';

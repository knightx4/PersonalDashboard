-- The notes-first essay (LEARN-ESSAYS-SPEC, "Notes first") has two views,
-- the notes and the draft, in place of the six stages. learn.essay_log
-- records which was opened under the same stage column, so the check
-- accepts both new names beside the old six, which older rows keep.

set search_path = learn, public, extensions;

alter table learn.essay_log drop constraint if exists essay_log_stage_check;
alter table learn.essay_log add constraint essay_log_stage_check check (
  stage is null or stage in ('notes', 'draft', 'discover', 'research', 'plan', 'structure', 'develop', 'write')
);

-- A goal's kind moves to the subject it points at (plan #2302.2).
--
-- The preparation reads the kind from learn.subjects (0167), but the four
-- goals were sorted on learn.aims (0160) before subjects had a kind, so their
-- subjects have none. Each goal's kind is copied to its subject where the
-- subject has none yet, with who chose it, why and when. From here the goal's
-- page reads and writes the subject's kind; aims.kind stays as it is and
-- nothing writes it.
--
-- Written against the owner's account only (CLAUDE.md): a subject that
-- already has a kind keeps it.

update learn.subjects s
set kind = a.kind,
    kind_reason = a.kind_reason,
    kind_by = a.kind_by,
    kind_model = a.kind_model,
    kind_at = coalesce(a.kind_at, now())
from (
  select distinct on (subject_id) subject_id, kind, kind_reason, kind_by, kind_model, kind_at
  from learn.aims
  where user_id = core.dev_owner_id()
    and subject_id is not null
    and kind is not null
    and kind_by is not null
  -- An open goal's kind over an archived one's, then the person's over a model's.
  order by subject_id, (archived_at is null) desc, (kind_by = 'person') desc, created_at
) a
where s.id = a.subject_id
  and s.user_id = core.dev_owner_id()
  and s.kind is null;

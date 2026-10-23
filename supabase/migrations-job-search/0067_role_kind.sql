-- What kind of opening a role is.
--
-- The pipeline was built for job postings, and some of what the person
-- pursues is not a job: an accelerator that takes them as a founder, a
-- fellowship, a grant. Each still has an application, questions, a deadline
-- and a result, so it lives in the same pipeline, and the kind says which it
-- is so the pages can name it and the list can group by it. Every existing row
-- is a job, so the column defaults to 'job'. Schema only.

alter table job_search.roles
  add column if not exists kind text not null default 'job';

alter table job_search.roles
  drop constraint if exists roles_kind_ck;
alter table job_search.roles
  add constraint roles_kind_ck check (kind in ('job', 'accelerator', 'fellowship', 'grant', 'other'));

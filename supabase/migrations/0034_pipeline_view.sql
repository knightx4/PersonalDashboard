-- Which shape the pipeline is drawn in, per person.
--
-- On the profile rather than in the URL: the board is reached from a link on
-- another page, so a query parameter would forget the choice on every visit,
-- and picking a view is a standing preference rather than a filter.
alter table job_search.profiles
  add column if not exists pipeline_view text not null default 'board'
  check (pipeline_view in ('board', 'list'));

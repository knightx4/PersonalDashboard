-- A company's perspective: the person's own view of a company they want to
-- focus on, kept as six short answers on the company's Perspective tab. What
-- the company does and how it makes money, why now, the problem they would
-- solve there, why them, what they do not know yet, and their next move.
-- perspective_updated_at is when any of the six last changed, so the Targets
-- view can say how fresh a view is.
alter table job_search.companies
  add column if not exists perspective_business text,
  add column if not exists perspective_why_now text,
  add column if not exists perspective_problem text,
  add column if not exists perspective_why_me text,
  add column if not exists perspective_unknowns text,
  add column if not exists perspective_next_move text,
  add column if not exists perspective_updated_at timestamptz;

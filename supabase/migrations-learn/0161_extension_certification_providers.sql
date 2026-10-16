-- The two providers the practical-skill pulls store under (plan #2247.7):
-- a cooperative extension short course and an association's exam outline.
-- Off, as the other 0160 providers are, until the person turns a source on.
insert into learn.catalogue_providers (slug, name, home_url, licence, ingest_note, enabled)
values
  ('uaex', 'University of Arkansas Cooperative Extension', 'https://www.uaex.uada.edu',
   'Copyright of the University of Arkansas System Division of Agriculture; structure only',
   'A short course page listing numbered lessons with a video and a handout PDF each, parsed from an allowlisted page. Handouts over 8 MB are not fetched.',
   false),
  ('isa-arbor', 'International Society of Arboriculture', 'https://www.isa-arbor.com',
   'Copyright of ISA; structure only',
   'The Certified Arborist examination outline PDF: domains with weights, tasks under each. Text extracted from the PDF.',
   false)
on conflict (slug) do nothing;

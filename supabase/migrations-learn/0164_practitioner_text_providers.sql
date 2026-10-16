-- The two practitioner guides a practical-skill pull stores under (plan #2247.6):
-- David Skok's SaaS Metrics 2.0 and a16z's 16 Startup Metrics. Off, as the
-- 0160 and 0161 providers are, until the person turns a source on.
insert into learn.catalogue_providers (slug, name, home_url, licence, ingest_note, enabled)
values
  ('forentrepreneurs', 'For Entrepreneurs (David Skok)', 'https://www.forentrepreneurs.com',
   'Copyright of Matrix Management Corporation; structure only',
   'One long guide parsed from an allowlisted page: its h2 sections in order, the h3 headings under each as topics.',
   false),
  ('a16z', 'Andreessen Horowitz', 'https://a16z.com',
   'Copyright of Andreessen Horowitz; structure only',
   'One long guide parsed from an allowlisted page: its numbered h3 sections in order, the h4 headings under each as topics.',
   false)
on conflict (slug) do nothing;

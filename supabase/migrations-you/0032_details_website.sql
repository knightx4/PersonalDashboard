-- The person's own website, on You's Details tab.
--
-- The essay Publish card named one person's site in code
-- (app/learn/e/[id]/essay-publish.tsx). It now names the site in this row,
-- the place a published essay is read from, and says "your site" while none
-- is given.

alter table you.details add column if not exists website_url text;

alter table you.details add constraint details_website_url_ck
  check (website_url is null or length(website_url) <= 500);

comment on column you.details.website_url is
  'Their own website, as they typed it. The essay Publish card links a published essay there.';

notify pgrst, 'reload schema';

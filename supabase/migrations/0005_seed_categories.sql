-- System category taxonomy, two levels.
--
-- Seeded as a migration rather than a run-once script so the database stays
-- reproducible. user_id is null on every row, which is what makes them system
-- categories -- see the categories RLS policy in 0004.
--
-- Colors are the shared visual language between the dashboard donut and the
-- inventory filters, so every top-level category gets one. Children inherit
-- their parent's color in the UI.

set search_path = public, extensions;

insert into categories (user_id, parent_id, name, slug, color) values
  (null, null, 'Clothing',    'clothing',    '#6A82FB'),
  (null, null, 'Electronics', 'electronics', '#4A9DD4'),
  (null, null, 'Home',        'home',        '#FF8A4C'),
  (null, null, 'Beauty',      'beauty',      '#FF6B9D'),
  (null, null, 'Health',      'health',      '#3FA37A'),
  (null, null, 'Groceries',   'groceries',   '#C9A227'),
  (null, null, 'Hobby',       'hobby',       '#9B72CF'),
  (null, null, 'Pet',         'pet',         '#E2725B'),
  (null, null, 'Other',       'other',       '#6B6B66');

insert into categories (user_id, parent_id, name, slug, color)
select null, p.id, c.name, c.slug, p.color
from categories p
join (values
  ('clothing', 'Tops',        'clothing-tops'),
  ('clothing', 'Bottoms',     'clothing-bottoms'),
  ('clothing', 'Outerwear',   'clothing-outerwear'),
  ('clothing', 'Shoes',       'clothing-shoes'),
  ('clothing', 'Accessories', 'clothing-accessories'),
  ('home',     'Kitchen',     'home-kitchen'),
  ('home',     'Furniture',   'home-furniture'),
  ('home',     'Decor',       'home-decor'),
  ('home',     'Bedding',     'home-bedding')
) as c (parent_slug, name, slug) on c.parent_slug = p.slug
where p.user_id is null;

-- Add Books as a top-level system category for auto-categorize.

set search_path = public, extensions;

insert into categories (user_id, parent_id, name, slug, color)
select null, null, 'Books', 'books', '#5B8C5A'
where not exists (
  select 1 from categories where user_id is null and slug = 'books'
);

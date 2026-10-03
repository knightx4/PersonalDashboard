-- Give each workspace vision an id, so a vision can be named by a ref
-- (plan #1451).
--
-- docs/CORE-AND-DASH-SPEC.md, Part 1: a ref is `schema.table:id`, always the
-- row's uuid `id`. public.module_visions (0093) is keyed by (user_id, module)
-- and had no id, so a vision found by search had nothing a ref could name.
-- This adds one. Existing rows are given an id by the default as the column
-- is added; the primary key stays (user_id, module), so the upserts that
-- write a vision are unchanged.
--
-- With an `id` and a uuid `user_id`, the table now also passes
-- core.ref_owned (0156).

alter table public.module_visions
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.module_visions
  add constraint module_visions_id_key unique (id);

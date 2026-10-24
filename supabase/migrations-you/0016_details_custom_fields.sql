-- Fields of the person's own on the Details tab (plan #2531.1).
--
-- custom_fields is a list of {id, label, value}: up to 30, each label up to 80
-- characters and each value up to 500. An empty list is the default. Schema
-- change only; no existing row is rewritten.

create or replace function you.custom_fields_ok(fields jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(fields) = 'array'
    and jsonb_array_length(fields) <= 30
    and not exists (
      select 1
      from jsonb_array_elements(fields) as f(item)
      where jsonb_typeof(f.item) <> 'object'
        or jsonb_typeof(f.item -> 'id') is distinct from 'string'
        or jsonb_typeof(f.item -> 'label') is distinct from 'string'
        or jsonb_typeof(f.item -> 'value') is distinct from 'string'
        or length(f.item ->> 'id') not between 1 and 64
        or length(f.item ->> 'label') not between 1 and 80
        or length(f.item ->> 'value') > 500
    );
$$;

alter table you.details
  add column if not exists custom_fields jsonb not null default '[]'::jsonb;

alter table you.details
  add constraint details_custom_fields_ck check (you.custom_fields_ok(custom_fields));

comment on column you.details.custom_fields is
  'Fields of their own: a list of {id, label, value}, at most 30, labels up to 80 characters and values up to 500.';

notify pgrst, 'reload schema';

-- A global merchant for LinkedIn (plan #2432.8).
--
-- The LinkedIn import files each Premium and Learning charge as an order, and
-- an order shows its merchant by name. The import engine can only write tables
-- that carry user_id, which merchants does not, so the importer points orders
-- at this one shared merchant by its fixed id instead of making a merchant per
-- account. It is global and holds no domains, so no email is ever matched to
-- it. One insert of a catalogue row; no account's rows are read or changed.

insert into public.merchants (id, name, slug, domains, is_global)
values ('6c1f0a52-3b7e-4d8a-9e21-4a5b7c9d0e13', 'LinkedIn', 'linkedin', '{}', true)
on conflict do nothing;

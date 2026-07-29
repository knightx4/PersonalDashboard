-- Revolve: fashion marketplace with a stable 30-day refund window
-- (60 days for exchanges — we model the refund window only).
-- Also added to 0006 for fresh installs; this migration covers existing DBs.

set search_path = public, extensions;

insert into merchants (name, slug, domains, default_return_window_days, is_global)
select
  'Revolve',
  'revolve',
  array['revolve.com', 'email.revolve.com'],
  30,
  true
where not exists (
  select 1 from merchants where slug = 'revolve' and is_global
);

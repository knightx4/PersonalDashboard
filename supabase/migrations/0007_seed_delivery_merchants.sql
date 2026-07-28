-- Delivery platforms that show up in connected inboxes.
-- Domains power Tier A classification; return windows stay null.

set search_path = public, extensions;

insert into merchants (name, slug, domains, default_return_window_days, is_global)
values
  ('DoorDash',     'doordash',     array['doordash.com','mail.doordash.com'], null, true),
  ('Uber Eats',    'uber-eats',    array['ubereats.com','uber.com'],          null, true),
  ('Grubhub',      'grubhub',      array['grubhub.com','email.grubhub.com'],  null, true),
  ('Toast',        'toast',        array['toasttab.com','toast.com'],         null, true),
  ('Order.online', 'order-online', array['order.online'],                     null, true),
  ('UrbanStems',   'urbanstems',   array['urbanstems.com'],                   null, true)
on conflict (slug) where is_global do update
  set domains = (
    select array_agg(distinct d)
    from unnest(merchants.domains || excluded.domains) as d
  ),
  updated_at = now();

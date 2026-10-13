-- The device each page was opened on (plan #1919.6, docs/ONE-INTERFACE-SPEC.md
-- part 8, R17).
--
-- Whether the app is mostly used on a phone was not recorded, though the UI
-- quality rules assume it. proxy.ts now reads the user agent when it writes a
-- page view: 'phone' for iPhone, iPad and Android, 'laptop' for anything else.
-- Rows written before this migration have no device, so the column is nullable
-- and the Usage tab counts only rows that have one.

alter table core.page_views add column device text;

alter table core.page_views
  add constraint page_views_device_ck check (device is null or device in ('phone', 'laptop'));

comment on column core.page_views.device is
  'phone or laptop, read from the user agent by proxy.ts; null for rows written before it was recorded (plan #1919.6).';

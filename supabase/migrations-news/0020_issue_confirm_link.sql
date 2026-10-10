-- The confirmation link in a signup email, and when the person confirmed it
-- (plan #1723, under #1722 "Confirm a newsletter signup with one button").
--
-- When an issue is digested as a confirmation (purpose, 0014), the digest
-- picks out the link the email asks you to press and stores it here
-- (lib/news/issues/confirm-link.ts). The issue page and the newsletter list
-- then show a Confirm button that opens it in a new tab. The app never visits
-- the link itself, since a link opened by a server could subscribe the person
-- to something they did not choose.
--
-- Only https links are stored, and none when no link is clear, so a button
-- shows only for a link worth trusting. Pressing it sets confirmed_at, and the
-- button gives way to a line saying when.

set search_path = news, public, extensions;

alter table news.issues
  add column if not exists confirm_url text,
  add column if not exists confirmed_at timestamptz;

alter table news.issues add constraint issues_confirm_url_ck check (
  confirm_url is null or confirm_url ~ '^https://'
);

comment on column news.issues.confirm_url is
  'The https link a confirmation email asks you to press to finish '
  'subscribing (plan #1723). Set when the issue is digested as a '
  'confirmation; null for every other issue and when no link was clear.';

comment on column news.issues.confirmed_at is
  'When the person pressed Confirm on the issue. Null until then.';

notify pgrst, 'reload schema';

-- Where home is, as a point on the map (plan #2987.1, under #2987).
--
-- The chats' places lookup (#2987.2) searches near home. Home is the mailing
-- address on You > Details, geocoded once with the Google Geocoding API
-- (lib/you/home-location.ts). These columns keep the point and the address
-- it was made from, so the address is sent to Google again only when it
-- changes: a mailing_address that no longer matches home_geocoded_address
-- means the point is stale.
--
--   home_lat, home_lng       the point, in degrees; both set or both null
--   home_geocoded_address    the mailing address the point was made from,
--                            as it was sent
--   home_geocoded_at         when it was made
--
-- Schema only: no row is written here.

alter table you.details
  add column if not exists home_lat double precision,
  add column if not exists home_lng double precision,
  add column if not exists home_geocoded_address text,
  add column if not exists home_geocoded_at timestamptz;

alter table you.details add constraint details_home_point_ck check (
  (home_lat is null and home_lng is null)
  or (home_lat between -90 and 90 and home_lng between -180 and 180)
);
alter table you.details add constraint details_home_geocoded_address_ck
  check (home_geocoded_address is null or length(home_geocoded_address) <= 500);

comment on column you.details.home_lat is
  'Latitude of home, geocoded from mailing_address; null until it has been. Stale when home_geocoded_address differs from mailing_address.';
comment on column you.details.home_lng is
  'Longitude of home, geocoded from mailing_address; null until it has been.';
comment on column you.details.home_geocoded_address is
  'The mailing address home_lat and home_lng were geocoded from, as sent to Google.';
comment on column you.details.home_geocoded_at is
  'When home_lat and home_lng were last geocoded.';

notify pgrst, 'reload schema';

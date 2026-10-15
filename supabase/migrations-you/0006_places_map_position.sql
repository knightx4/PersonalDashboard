-- Each place can remember where it is on the map (plan #2091.2).
--
-- Latitude and longitude, in degrees, both optional and empty by default, so
-- every place that exists keeps loading as it did. A place holds both or
-- neither: one without the other places nothing.

alter table you.places
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table you.places
  add constraint places_latitude_ck check (latitude is null or latitude between -90 and 90),
  add constraint places_longitude_ck check (longitude is null or longitude between -180 and 180),
  add constraint places_position_pair_ck check ((latitude is null) = (longitude is null));

comment on column you.places.latitude is
  'Degrees north of the equator, -90 to 90. Null until the place is put on the map; set together with longitude.';
comment on column you.places.longitude is
  'Degrees east of the prime meridian, -180 to 180. Null until the place is put on the map; set together with latitude.';

notify pgrst, 'reload schema';

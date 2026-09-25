-- A resting track offered back to you in Learn now (plan #1045).
--
-- A track goes dormant after four weeks untouched while other tracks are used,
-- and from then on Learn now left it out. Two weeks later it is now offered
-- back as one card, with Pick it up, Not now and Let it rest. Each press is
-- kept in `learn.track_offers`, beside the presses on new-track offers made
-- from a theme (0030), because the two share the one offer a visit and the
-- same reading decides what that offer is.
--
-- A row now says which kind of offer it answered:
--
--   theme    a theme from the vault map offered as a new track. As before:
--            the theme's id and name are set, and `subject_id` only on Start.
--   resting  a track of yours that has gone dormant. No theme; `subject_id`
--            is the track. Pick it up is `picked_up`, Not now is `not_now`
--            and Let it rest is `rested`.
--
-- `subject_id` keeps its foreign key and its `on delete set null`, so deleting
-- a track leaves the record of the press with no track, as it does for Start.

set search_path = learn, public, extensions;

alter type learn.track_offer_outcome add value if not exists 'picked_up';
alter type learn.track_offer_outcome add value if not exists 'rested';

create type learn.track_offer_kind as enum ('theme', 'resting');

alter table learn.track_offers
  add column kind learn.track_offer_kind not null default 'theme';

alter table learn.track_offers
  alter column theme_id drop not null,
  alter column theme_name drop not null;

alter table learn.track_offers drop constraint track_offers_subject_ck;

alter table learn.track_offers
  -- A theme offer names its theme; a resting offer names none.
  add constraint track_offers_kind_ck check (
    (kind = 'theme' and theme_id is not null and theme_name is not null)
    or (kind = 'resting' and theme_id is null and theme_name is null)
  ),
  -- A theme offer's track is the one Start made; a resting offer's is the
  -- track it offered back.
  add constraint track_offers_subject_ck check (
    kind = 'resting' or outcome = 'started' or subject_id is null
  );

comment on column learn.track_offers.kind is
  'theme: a theme offered as a new track. resting: a dormant track offered back (plan #1045).';

comment on table learn.track_offers is
  'One row per press on a track offer: a theme offered as a new track (started, '
  'not now, never), or a resting track offered back in Learn now (picked up, '
  'not now, rested). Nothing records that an offer was shown.';

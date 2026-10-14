-- Recording mode on Idea Space (plan #1997.9): a person making a video of
-- the map hides the names of the places they choose, and of the ideas in
-- them. Two settings on the row each person already has in learn.settings;
-- no new table. The place ids are those of learn.idea_places, which keeps an
-- id when the daily run names the place again, so a choice outlasts a run.
-- A place that is gone leaves its id here harmlessly.

alter table learn.settings
  add column if not exists idea_space_recording boolean not null default false,
  add column if not exists idea_space_hidden_places uuid[] not null default '{}';

comment on column learn.settings.idea_space_recording is
  'Idea Space shows "A private place" and "Private idea" for the hidden places while this is on (plan #1997.9).';
comment on column learn.settings.idea_space_hidden_places is
  'The learn.idea_places ids whose names, and the names of the ideas in them, recording mode hides (plan #1997.9).';

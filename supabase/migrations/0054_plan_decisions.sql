-- Decisions and fog: the two things a proposal could not say until now.
--
-- 0053 gave the plan proposals, which is a session writing a feature and its
-- steps for a person to approve. Two gaps showed up the first time that was
-- used in anger. A shaping session that hits a real question -- which of two
-- shapes, whether a thing is worth its cost -- has nowhere to put it, so it
-- picks one and writes steps as though the question were settled. And a
-- session that can see the first half of a feature clearly and the second half
-- not at all has to either invent the second half or leave it out, and both
-- are worse than saying so.
--
--   kind        'build' or 'decision'. A decision is a step whose resolution
--               is an answer rather than a commit: the question, the two or
--               three real options and what each costs, written by whoever
--               shaped the feature, closed by the person on the page.
--   fog         The "not yet specified" note. One paragraph on what is not
--               yet known, on the step it belongs to.
--   resolution  The answer a decision closes with, in the person's words.
--
-- A decision is a *kind* rather than a status because it moves through exactly
-- the states a build step moves through -- not started, in progress, blocked,
-- done, dropped -- and differs only in what closing it means: an answer
-- recorded in `resolution` instead of a commit recorded in `commit_sha`. Made
-- a status, "decision" would have to be crossed with all five of those to say
-- anything about where the question stands, and a step could not be both
-- unanswered and blocked. As a kind it is orthogonal, which is what it is.
--
-- Fog is a column on the step rather than a table of its own because it has no
-- life beyond the step: it is one paragraph that graduates into sub-steps and
-- disappears the moment they exist. A table would buy history nobody asked for
-- and a join on every read of the tree. Meaningful mostly on a feature, but
-- allowed anywhere, because a step that is half understood is a real thing
-- too and the alternative is a constraint that has to know what a feature is.
--
-- Text with a check for `kind`, for the reason 0051 gives about `status`: this
-- is a list somebody may want a third value on, and a check constraint is one
-- migration where an enum is three. RLS, the grants and the triggers on the
-- table are untouched -- these are columns on a table that already has all of
-- them, and every row that exists reads 'build', which is what it was.

set search_path = public, extensions;

alter table plan_items
  add column if not exists kind text not null default 'build',
  add column if not exists fog text,
  add column if not exists resolution text;

alter table plan_items drop constraint if exists plan_items_kind_ck;
alter table plan_items add constraint plan_items_kind_ck
  check (kind in ('build', 'decision'));

alter table plan_items drop constraint if exists plan_items_fog_length_ck;
alter table plan_items add constraint plan_items_fog_length_ck
  check (fog is null or length(fog) <= 4000);

alter table plan_items drop constraint if exists plan_items_resolution_length_ck;
alter table plan_items add constraint plan_items_resolution_length_ck
  check (resolution is null or length(resolution) <= 4000);

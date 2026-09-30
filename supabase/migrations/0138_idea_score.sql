-- A score from Jev on each idea (plan #1326, under feature #1320).
--
-- Jev is asked how much an idea helps what its workspace is for, effort left
-- out (decision #1325), as a five-level question scaled to 0 to 100 the way
-- the opening scores are (plan #1202). The answer is kept on the idea beside
-- its triage so the Ideas tab can rank by it without asking again.
-- Shape and reading: lib/ideas/score.ts (`IdeaScore`, `scoreFrom`).
--
-- One jsonb column shaped like triage: {"value": 0-100, "confidence": 0-1,
-- "at": ISO time asked}. Null means no score yet: an idea filed before this,
-- filed by a session through scripts/plan.ts, or one Jev failed on. The
-- catch-up scores every live idea whose score is null, so a failed call is
-- retried there rather than recorded.

alter table public.ideas add column score jsonb;

comment on column public.ideas.score is
  'Jev''s score of how much the idea helps its workspace''s vision, effort left out: value 0 to 100, confidence, and when it was asked (plan #1326). Null until scored. Read by lib/ideas/score.ts.';

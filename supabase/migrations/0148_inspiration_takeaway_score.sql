-- Jev's score on each inspiration takeaway (note 790c745a).
--
-- Ideas carry a 0 to 100 score from Jev (0138); the Inspiration tab now ranks
-- its takeaways the same way, best first. The question and the scale are the
-- ideas' own (lib/ideas/score.ts), asked of the takeaway's title and body
-- against its workspace's vision.
--
-- public.inspiration_takeaways.score
--   { value 0..100, confidence 0..1, at }, as ideas.score; null until scored.
--   The daily idea-score catch-up scores every takeaway still null that is
--   not dismissed (lib/dev/inspiration/score.ts).

alter table public.inspiration_takeaways add column if not exists score jsonb;

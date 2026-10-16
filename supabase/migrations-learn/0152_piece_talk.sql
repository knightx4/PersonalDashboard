-- Where a piece worked as a conversation with Dash on Now has got to (plan
-- #2164.5). The turns themselves are in core.conversations under the piece's
-- ref; this column is the part of the thread the server needs to mark the next
-- answer: the idea being asked about and its question's row in learn.probes,
-- the follow-up's row once one is asked, or the piece check's row in
-- learn.piece_checks. Null until the first answer.
--
-- Shapes, read by lib/learn/lessons/piece-talk.ts:
--   {"stage":"explain","conceptId":…,"probeId":…}
--   {"stage":"follow_up","conceptId":…,"probeId":…,"followUpId":…}
--   {"stage":"check","checkId":…}       (null when the check could not be written)
--   {"stage":"done"}

alter table learn.plan_pieces
  add column if not exists talk jsonb;

comment on column learn.plan_pieces.talk is
  'Where the piece''s conversation with Dash on Now has got to: the idea and question row '
  'being answered, the follow-up, or the piece check. Null until the first answer (plan #2164.5).';

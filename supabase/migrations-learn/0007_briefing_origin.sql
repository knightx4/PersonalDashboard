-- A concept can say it came out of a briefing you pasted.
--
-- `learn.concept_origin` has four values and none of them fit an import. A
-- briefing is not `generated` -- nothing proposed these claims for a goal, they
-- were pulled out of prose somebody handed you -- and it is not `reading`,
-- which means a note you wrote after reading something. The difference matters
-- on the day a claim turns out to be wrong: `generated` points at the model
-- that laid out a chain, `briefing` points at a document and a date.
--
-- Adding a value to an enum cannot be undone in Postgres, and nothing can use
-- the new value in the transaction that adds it. Both are fine here: this file
-- adds it and writes nothing.

alter type learn.concept_origin add value if not exists 'briefing';

-- The one-sentence takeaway on a Learn now card (note 125f60f2).
--
-- The owner asked for a callout at the top of each card with the most
-- important thing to take from it, in one plain-English sentence. The card
-- writer (lib/learn/feed/write-card.ts) now writes it beside the context,
-- hook, summary and example, and the card shows it first, under the title.
--
-- Nullable: cards written before this carry none and show no callout, and a
-- card whose takeaway came back empty or too long to be one sentence is still
-- shown, since the rest of it was written.

set search_path = learn, public, extensions;

alter table learn.feed_cards add column if not exists takeaway text;

# Learn now

The first tab in Learn: an endless feed of things to read next, one card at a
time, chosen from what you write about and from the fields you have never
touched. You scroll, read, and move on. Nothing on it asks you a question.

Practice Flow keeps the questions, and only the questions. The two tabs split
Learn by what you are in the mood for: taking something in, or being tested on
it.

Written to [WRITING-GUIDE.md](WRITING-GUIDE.md). The decisions below were made
by the owner on 23 September 2026.

---

## What changes in Learn

- **Learn now is the first tab**, at `/learn/now`, and opening Learn lands on
  it. It replaces the Read now tab. The readings you queued yourself are still
  there: they come first in the feed, ahead of anything the app picked.
- **Practice Flow is questions only.** The readings #773 folded into the flow
  after an answer move to Learn now. The new-track card stays in the flow,
  because starting a track is how the flow gets more questions.
- The other tabs (Tracks, Reading lists, Quizzes) are unchanged.

## Two rules this overturns

[LEARN-SPEC.md](LEARN-SPEC.md) was written for a reading queue, and two of its
rules do not hold for a feed. The owner has set both aside for Learn now:

- **"Not a reader."** Learn now shows the source's own text on the card where
  the source allows it. Wikipedia does, under CC BY-SA, with the article named
  and linked on every card. The reason is friction: reading in the feed beats
  leaving the app for every card.
- **"Not a summarizer."** Every card carries a short summary written by a
  model, so a card whose text cannot be shown still tells you what you would
  get, and so a long section can be judged at a glance before you read it.

The rule that stays is the one LEARN-SPEC is built on: **never send someone to
a page that is not there.** Every card links to its source at the section it
came from, and a card is only made from material that was actually fetched.

## A card

| Part | What it is |
|---|---|
| Title | The article and section, e.g. "Inflation: Causes" |
| Why it is here | One line, naming the field and either your theme ("You write about economic system design") or the gap ("A field you have never been tested in") |
| Summary | Three or four sentences, written from the fetched text, never from memory |
| The text | The section itself, when the source allows it, collapsed to a readable length with "Read the rest" |
| Source | The article's name, the licence, and a link to the section |
| Actions | Next, Save (to a reading list), Not interested, Test me on this |

"Test me on this" hands the card's subject to Practice Flow as a track; it is
the one bridge between the tabs, and it is always optional.

## What the feed pulls from

About three cards in four come from **interest**: the fields and themes you
write about most, weighted by theme strength. About one in four comes from a
**gap**: a field you write about but have never been tested in first, then a
field with nothing in it at all. Every card says which it is.

Your own queued readings are served before either, in the order you queued
them.

## How cards are made

The catalogue is empty, so the feed has to fill it. A background pass keeps
about twenty cards ready per person, and runs hourly and whenever the ready
count drops below ten.

1. **Pick a target.** Three in four draws take a strong theme, weighted by
   strength; one in four takes a gap field. The draw skips anything with a
   card made in the last few weeks.
2. **Name the material.** One model call names two or three Wikipedia
   articles, and the section in each, that someone interested in the target
   should read next. The code checks each title exists before anything else
   happens.
3. **Fetch it.** The existing Wikipedia sweep pulls the article into the
   catalogue as items and segments.
4. **Write the card.** One model call reads the fetched section, says whether
   it serves the target, and writes the summary. A section that does not serve
   the target is dropped, no card is made, and the model's reason is kept on
   the row. The "why" line is built from the row rather than written by the
   model, so it always names the right field and reason.

The hourly run tops up anyone with fewer than twenty ready cards. After a
response on the feed page, it runs only once fewer than ten are ready. It
writes the picked rows first and picks more targets only when they run out.

Wikipedia first, because it needs no key and its text can be shown. Lecture
clips join once the catalogue has courses in it (plan #789).

## What is recorded

Only what you do on purpose: Save, Not interested, Test me on this, and
opening the source. Scrolling past a card records nothing, the same rule
LEARN-GRAPH-SPEC holds What next to. Not interested lowers the weight of that
card's theme or field for later draws; Save raises it.

## Cost

Two model calls per card, one to name the material and one to write the card.
At a few hundred tokens out each on Sonnet, twenty cards is roughly ten cents.
Recorded in the spend ledger under their own operations.

## Build order

1. The tab change: Learn now first, Read now's queue inside it, readings out of
   Practice Flow.
2. The card store and the pass that picks targets and names material.
3. Writing cards from fetched sections, and keeping twenty ready.
4. The feed page.
5. Weights from Save and Not interested.

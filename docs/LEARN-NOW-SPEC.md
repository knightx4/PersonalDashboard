# Learn now

The first tab in Learn: an endless deck of things to learn next, one card at a
time, chosen from what you write about and from the fields you have never
touched. You read a card and swipe it away, saying whether you know it. Since
"Cards after the first week" below, each card carries a question to try, but
nothing is graded.

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

## Practice Flow

Practice Flow, at `/learn/flow`, asks one question after another. Since plan
#842 it asks about two kinds of subject:

- **Your tracks.** The ideas in each track, shared between tracks by how much
  you engage with each, as "What to do next" in
  [LEARN-GRAPH-SPEC.md](LEARN-GRAPH-SPEC.md) describes.
- **Subjects you write about that are not tracks.** A theme from your vault
  map with notes linked to it and no track made from it. The question tests
  one idea taken from those notes. These are survey questions. Each is kept in
  a hidden subject that no list of your tracks shows (decision #838), and the
  screen names the vault subject and its field above the question, with a line
  saying it is not one of your tracks.

A filter at the top of the page chooses between them:

| Filter | What it asks about |
|---|---|
| Everything, the default (`/learn/flow`) | Your tracks, and survey questions at the rate below |
| Tracks only (`/learn/flow?only=tracks`) | Your tracks and nothing else |

Practice this on a track, and Test me on this on a Learn now card, open the
flow on that one track (`?track=`). It asks only about that track, and the
filter is not shown.

### How often a survey question comes up

Decision #839 set the rate. It is worked out from the fields you write about,
meaning the fields with at least one of your themes placed in them:

- While any of those fields has no answered question, in a track or in the
  survey, one question in two is a survey question.
- Once each has at least one, the rate falls with the share of fields that
  still have fewer than three answered survey questions. A field where a track
  has an answered question counts as having three.
- Once every field has three, one question in five.

At one in n, the next question is a survey question when none of the n - 1
before it was. So at one in two the flow alternates, and at one in five it
asks one survey question after every four about your tracks. The rate and the
turn order are `surveyShare` and `surveySlots` in `lib/learn/survey/rate.ts`,
with tests beside them.

The subject a survey question is about is picked field by field, an untested
field first, so the questions spread across fields rather than all coming
from your strongest theme.

### Written ahead

Survey questions are written ahead into the same queue as track questions, so
the next question is on the screen without waiting for a model call. Tracks
only and a focused track leave a waiting survey question in the queue until
the flow is next opened with no filter. When your tracks have nothing left to
ask, the default flow asks survey questions alone. When a survey question
cannot be written, a track question takes its turn.

Survey answers are graded like any other answer. An answered survey question
counts towards its field being tested on the Know grid, the same as an answer
in a track placed there, and a field tested that way is no longer offered as
one you have never been tested in (plan #843).

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

Once you set an open-subject goal on the Goals page, one card in three is drawn
for a goal instead, and the other two keep the three-to-one split (plan #900).
The share is counted from when the oldest active goal was set, so a first goal
added after months of cards is not flooded to catch up. A goal card's why line
names the goal, and it starts at the depth set on the goal: familiar, solid and
deep pick at working, advanced and specialist. From there it moves the way a
theme does, counted by goal (plan #909): two goal cards marked Got it take a
familiar goal from working to advanced, and cards you said you need to work on
come back from another angle rather than deeper.

The Level 3 goal takes its turn in the same one card in three, but its cards
skip the naming call (plan #910). Each draw takes two articles at random from
the Level 3 list that you have shown no sign of knowing (nothing in the
evidence view: no Got it, no save, no right Test me answer) and that have never
been on a card of yours, and makes a card from each article's lead.

An article you claimed (a Got it or a save) but have not been tested on comes
back in the same draw once it is due (plan #912): a week after the claim, then
a month after that return, then every three months, until a right answer on
its Test me track moves it to tested. The gaps are `LEVEL3_RETURN_GAP_DAYS` in
`lib/learn/feed/level3.ts`. When one is due, the draw takes an untouched
article and a return in turn. A return stays on the same article, so its Test
me track still counts for it, but at a section no earlier card was cut from: a
naming call is given the earlier cards' titles and the open sections, and asked
for one that goes past them, a step harder each time. A reply naming anything
it was not offered is dropped.

Your own queued readings are served before either, in the order you queued
them.

## How cards are made

The catalogue is empty, so the feed has to fill it. A background pass keeps
about twenty cards ready per person, and runs hourly and whenever the ready
count drops to seven or fewer.

1. **Pick a target.** Three in four draws take a strong theme, weighted by
   strength; one in four takes a gap field. The draw skips anything with a
   card made in the last few weeks. With goals, one draw in three takes a
   goal, weighted by what you saved and turned down on its cards. A goal with
   a card in the last three days is passed over only for another goal, so a
   single goal still gets its share.
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
response on the feed page, it runs only once seven or fewer are ready, and
then writes fifteen. It writes the picked rows first and picks more targets
only when they run out.

Wikipedia first, because it needs no key and its text can be shown. Lecture
clips join once the catalogue has courses in it (plan #789).

## What is recorded

Next, Save, Not interested, Test me on this, and opening the source, plus one
thing you do without pressing anything: scrolling on until a card has gone out
of view above you, which counts the same as Next. Not interested lowers the
weight of that card's theme or field for later draws; Save raises it. Next and
scrolling past only take the card out of the feed and are never read as
dislike.

### How the page records it (plan #808)

Each deliberate action sets the card's status in `learn.feed_cards`, with
`acted_at`:

- **Next** marks it `passed` (plan #833), only if it was still `ready`. The
  feed shows `ready` cards only, so a card you passed is not shown on a later
  visit. Any other action may still follow a pass, since the card stays on the
  screen for the rest of the visit.
- **Scrolling past** marks it `passed` the same way (plan #835), once a card
  that was on the screen has left it through the top. A card that never came
  into view, or that leaves off the bottom because you scrolled back up, is not
  marked. Each card is marked at most once a visit, so Next and the scroll it
  causes are one write, and a card you saved or turned down this visit is not
  marked at all.
- **Opening the source** marks it `opened`, only if nothing else has been done
  to it.
- **Save** marks it `saved` and puts the section on one reading list, "Saved
  from Learn now", made the first time something is saved. The article is the
  source and the section is the reading's locator. The reading's id is kept on
  the card as `saved_reading_id`.
- **Not interested** marks it `dismissed`.
- **Test me on this** starts a track and marks the card `tested`, with the
  track in `subject_id`. The track is the article and the goal is the card's
  title ("Urbanization: Causes"), written with the same call a track from a
  theme uses and no approval screen. A second card from the same article adds
  to the same track. Practice Flow then opens on that track.

The first decision stands: once a card is saved, dismissed or tested, nothing
but Test me after a Save moves it again.

A pass, by Next or by scrolling, takes a card out of the ready pool like the
other actions, and asks for a top-up once the response has gone, so passing
enough cards to leave seven or fewer ready starts more being written. Cards
still ready stay in the pool while they are on the screen, so the page keeps the
list of cards already shown and asks only for others. A card that never reached
the screen, or that you scrolled back up away from, comes back on your next
visit, newest cards first. The tab's badge counts your queued readings, not the
cards, since there are always about twenty of those.

### How the draw uses it (plan #809)

The picking pass counts, per theme and per field, the cards you saved (any
card with `saved_reading_id`, including one later tested) and the cards you
marked Not interested. Opening the source, Test me without a Save, and a
`passed` card, whether passed by Next or by scrolling, count for nothing. An interest card counts towards its theme and its field; a
gap card has no theme and counts towards its field.

Each save multiplies the weight by 1.4 and each Not interested by 0.7, and the
result is held between 0.2 and 3. A theme is drawn in proportion to its
strength times its own weight times its field's, held between the same bounds
once, so a card you turned down moves its own theme further than its
neighbours. Within each kind of gap, untested and then untouched, a field is
drawn in proportion to its weight; the order of the two kinds does not change.
The floor keeps a field you turned down coming up now and then, and the cap
stops a couple of saves crowding out everything else.

The counts are worked out from `learn.feed_cards` each time the pass runs,
with no table of their own: the action is already on the card, and the pass
already reads every card for the person. The code is
`lib/learn/feed/preference.ts`.

## Cards after the first week

Decided by the owner on 23 September 2026, after using the feed. The first
cards were dull: each was a summary of a Wikipedia section, so most of them
restated definitions, nothing was applied, and many were pitched too low (one
card was the lead of "Supply and demand"). Scrolling past a card also told the
app nothing about whether the person knew it. Four changes follow.

### What a card carries

The writer (plan #807's call) now writes four parts from the section, and a
card without the first three is dropped:

| Part | What it is |
|---|---|
| Context | One paragraph, first on the card: what the subject is, where and when it sits, who the people and works it mentions are, and any term the rest relies on. Written at the card's depth, in plain words, and may draw on well-established knowledge. Added after the owner found a card that opened on "the section argues, following Eisenstein" with no word on who Eisenstein was. |
| Hook | One or two sentences after the context: the most interesting thing in the section, stated concretely. Never a definition. |
| Summary | Two or three sentences from the section's text alone. |
| In practice | The idea applied to one specific case, or a worked calculation. The model may use what it knows here, and only this part. |
| Try this | A question that makes you use the idea, with the answer behind a tap. Left off when the model writes no answer. |

No part may refer to "the section", "the article" or "the text": the reader has not seen them, and the card has to stand on its own.

The section's own text is folded under "Read the section". This overturns the
earlier rule that the summary uses only the fetched text: the owner asked for
applied material, and a Wikipedia section rarely carries a worked case.

A card written before the context paragraph existed is not served as a new ready card, and does not count towards the twenty, so the top-up replaces it; if one comes back after a skip or "work on this" it is shown without the paragraph.

Cards written before this have no hook. They are no longer shown and no longer
count towards the twenty kept ready, so the top-up replaces them. Their rows
are kept.

### How deep a pick goes

Every pick starts at `working`: past the definitions and basics. The naming
call is told not to name the lead of a broad article, and to prefer a narrow
article about one mechanism, case or model. A named section the article does
not have is now dropped rather than replaced by the lead.

Each card on a theme swiped as known counts towards the next level: two for
`advanced`, five for `specialist`. A gap card counts towards its field. The
naming call is given the titles swiped as known and told to go past them, and
the titles swiped as "work on this" and told to come at those ideas from
another article. The level is stored on the pick as `depth`, shown on the
card, and passed to the writer, which drops a section that only restates what
that level is past. Code: `lib/learn/feed/depth.ts`.

The Too hard and Too easy buttons on a card (plan #894) move the same count.
A card rated too easy adds one and a card rated too hard takes one off, so the
count is known cards plus too-easy cards minus too-hard cards, never below
zero. One Too hard on an advanced theme takes it back to working. A rating is
read apart from the swipe: a card rated but never swiped still counts, and a
card swiped as known and rated too easy counts twice. Ratings on a gap card
count towards its field, as its swipes do.

Working stays the lowest level (plan #892). Too hard on a working theme leaves
the level where it is. The naming call is given the titles rated too hard on
that theme or field and told to come at those ideas from a simpler angle,
easier than those cards. A rating does not fetch new cards on its own; it
changes the next picks made for that theme or field.

### The three swipes

One card is on the screen at a time. It is left by a swipe, an arrow key, or
the three buttons held at the foot of the card:

| Swipe | Key | Status | What follows |
|---|---|---|---|
| Down: Got it | ↓ | `known` | The next picks on its theme go deeper. |
| Right: Work on this | → | `review` | The card comes back after two days. Its theme counts it as a save and is drawn again without waiting out the three weeks. |
| Left: Not now | ← | `skipped` | The card comes back after three days. Nothing else changes. |

A downward swipe counts only from the top of the page, since further down the
same gesture is scrolling back up. Swipes are not final: a card that came back
can be swiped again. Save, Test me on this and Not interested stay on the card
as smaller buttons; Not interested also takes the card off the deck.

The deck replaces the Next button and the scroll-past marking of plans #833
and #835, described under "What is recorded". Both existed so a card you had
moved past would not come back; on the deck every card is left by a swipe,
which says that and more. Cards already marked `passed` keep the status and
are not shown again.

The deck asks for more cards while four are still ahead, so moving on never
waits for the network. It serves returning "work on this" cards first, then
ready cards newest first, then returning skipped ones.

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

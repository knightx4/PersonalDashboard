# Learn lessons: curriculum first

Decided by the owner on 24 September 2026. Not built yet; the build order is at
the end.

## Why this changes

Learn now began with a Wikipedia section and made cards from whatever the
section held. Splitting sections into single ideas ([LEARN-NOW-SPEC](LEARN-NOW-SPEC.md),
"One idea per card") made each card clearer. It did not change the underlying
problem: nothing decided what the person should learn next, in what order, or
towards what. The section was the starting point, and the learning was whatever
fell out of it.

Tracks already have the missing half. A track has a curriculum of units, each
unit opens into a chain of concepts, each concept is one testable claim, and
prerequisite edges join them ([LEARN-GRAPH-SPEC](LEARN-GRAPH-SPEC.md)). What
tracks lack is teaching: Practice Flow asks questions about concepts and never
explains one first.

So the two are joined. The curriculum decides what is taught, and a lesson is
written for one concept at a time. Wikipedia becomes the evidence behind a
lesson and the place to read more.

## The shape

| Level | What it is | Where it lives |
|---|---|---|
| Track | One subject you are learning, such as economics. | `learn.subjects` |
| Unit | A step in the track's curriculum, with what it covers and what you can do once it is learned. | `learn.curriculum_units` |
| Concept | One claim you can be right or wrong about, with prerequisite edges to others. | `learn.concepts`, `learn.concept_edges` |
| Lesson | The card that teaches one concept. | `learn.feed_cards` |

Learn now is the mixed feed: lessons from all your tracks, interleaved, with
exploratory cards among them. The Tracks tab is where one track is seen on its
own, with its units and where you stand in each.

## What the feed deals

A slot in the feed goes to one of four things:

1. **A lesson** from one of your tracks, for most slots.
2. **An exploratory card**, one slot in five: an idea near your themes that
   belongs to no track yet. These are made the way Learn now cards are made
   today, from a Wikipedia section, and each carries a "Make this a track"
   button.
3. **A track offer**, when a theme from your notes has no track: "You write a
   lot about continuity and precedent. Want a curriculum for it?" Start, Not
   now and Never, as Practice Flow offers them today (`learn.track_offers`).
   At most one offer is in the ready cards at a time.
4. **A returning card**: one you swiped Work on this, after two days, or Not
   now, after three, as today.

The order they are served in follows "The order of the deck" in LEARN-NOW-SPEC:
no two cards from one track or article within four of each other where the
pool allows it.

## How slots are shared between tracks

There is no limit on how many tracks you have. What changes with more tracks is
the share each one gets.

Each track's share is its weight from Practice Flow (`lib/learn/flow/interest.ts`),
read from the last four weeks, with lesson swipes counted beside answered
questions: Got it and Work on this count as engaging with the track, and Not
now as moving past it. A track with no history weighs 1, and weights run from a
quarter to four.

A track with nothing done on it for four weeks, while other tracks were used,
is **dormant**. It takes no share until you open it on the Tracks tab or start
a lesson from it there. It is never deleted.

Lessons are written only for the ready cards, the same twenty kept ready today,
and a unit's chain of concepts is written only when the unit is reached. So the
number of tracks changes what each one gets, not what the feed costs.

## The next lesson in a track

Once a track has a slot, its next concept is read off the graph with no model
call. It is a concept you do not know yet whose prerequisites you do, in the
first unit that is not done. Ties go to the concept nearest the unit's outcome.

When the unit has no chain yet, its chain is written first, with the call that
opening a unit makes today (`generateChain`). When the track has no unit left
that is not done, the next unit is written first (see "Units are written as you
go").

## A lesson

A lesson teaches one concept. Its parts are the parts an idea card has now:

| Part | What it is |
|---|---|
| Title | The concept's name. The track and unit are named under it. |
| Takeaway | The concept's claim, in one plain sentence. |
| Context | Only what the claim needs to be followed. |
| Evidence | A number, case or result that supports it. |
| Why it holds | The mechanism, in two or three sentences. |
| In practice | The idea applied to one specific case. |
| Try this | A question that makes you use it, with the answer behind a tap. |
| Read more | The closest source in the catalogue, when one is close enough. |

A lesson is written from the model's own knowledge, in one Sonnet call. Before
the call, the catalogue is searched for the concept's claim (the search in
`lib/learn/catalogue/search.ts`), and the closest section, when there is one,
is passed in. The call checks the lesson against that text and takes its
evidence from it where it can. A lesson whose claim the source contradicts is
not served, and the contradiction is kept on the row.

## What a swipe does

| Swipe | The concept | What follows |
|---|---|---|
| Got it | `known`, on your word | The concepts that build on it become ready. |
| Work on this | `shaky`, on your word | The lesson comes back after two days. |
| Not now | unchanged | The lesson comes back after three days. |
| Too hard | unchanged | A prerequisite is added under the concept, and its lesson comes first. |

A state a test established is never overwritten by a swipe, as today. Answers
in Practice Flow keep moving concepts as they do now, and a lesson for a
concept already known is not written.

Too hard uses the same step a probe takes when a wrong answer shows a missing
floor (LEARN-GRAPH-SPEC, "The graph is never finished", trigger 2).

## Units are written as you go

A new track gets its first three or four units, where today it gets six to
twelve at once. Each unit is fixed once written: its title, what it covers and
its outcome do not change. The concepts inside a unit still grow and are still
skipped, as the graph always has.

A unit is **done** when every concept on the path to its outcome is known, by a
test or by your word.

When the last unit of a track is done, or has fewer than three concepts left
that are not known, the next unit is written. The call is given the units so
far, which concepts you know, and which you rated too hard or kept for work,
so the new unit builds on what you have shown. Tracks written before this keep
all their units, and new ones are added after the last.

## The unit check

When a unit is done, the next card from that track is its unit check: one
question that needs the unit's concepts together, answered in a sentence or
two. Haiku marks the answer against the unit's outcome.

The check is optional. It can be skipped, and a unit is done whether or not it
was taken. A right answer marks the unit's concepts as tested, which your word
alone never does.

## What happens to today's pieces

- **Section picking** (naming, fetching and writing from a section) makes the
  exploratory cards and nothing else.
- **Goals set on the Goals page** get a track each, since you set them on
  purpose. Their card share (one in three) becomes that track's weight.
- **Idea cards already written** stay in the feed until they are used up.
- **Hidden per-article subjects** made for idea cards are no longer made. The
  ones that exist keep their concepts; pressing Test me on this, or Make this a
  track, turns one into a track as today.

## Cost

From the spend ledger, 24 September 2026:

| Call | When | About |
|---|---|---|
| A track's first units | Once per track | 1.5¢ |
| A further unit | When a track runs out of units | 1.5¢ |
| A unit's chain of concepts | When the unit is reached | 4¢ |
| A lesson | Once per concept served | 1.5¢ |
| A unit check marked | When one is answered | 0.2¢ |

A lesson is written only for a concept that is about to be served, so nothing
is thrown away after writing. About half of the sections picked today are.

## Build order

Each step ships on its own.

1. **Lessons for track concepts.** The top-up writes lessons for the ready
   concepts of tracks you already have, by track weight, with exploratory cards
   at one in five. Swipes set the concept's state.
2. **Track offers in the feed.** Themes with no track are offered as cards, and
   exploratory cards carry "Make this a track".
3. **Units written as you go.** New tracks start with three or four units, and
   a unit is added when a track runs short.
4. **Too hard adds a prerequisite.**
5. **The unit check.**
6. **Goals as tracks.** A goal on the Goals page gets a track.

## Open questions

- The Level 3 goal draws articles from a fixed list rather than a curriculum.
  Whether it becomes a track of its own, or stays an exploratory source, is not
  decided.
- Whether a dormant track should be offered back after a while, as a card.

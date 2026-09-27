# Learn lessons: curriculum first

Decided by the owner on 24 September 2026. Step 1 of the build order at the end
is built (plan #978), and "Step 1 as built" says how it works. The other steps
are not built yet.

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
a lesson from it there. It is never deleted, and two weeks after it goes
dormant it is offered back (below).

## A resting track is offered back

Two weeks after a track goes dormant, so six weeks after it was last used, it
comes back to Learn now as one card asking whether to pick it up again, with
Pick it up, Not now and Let it rest. A goal's track is never offered, since it
does not go dormant while the goal is active.

The card takes the place of the theme offer: one offer a visit, shown after the
second card, and a visit with a resting track to offer shows no theme. When
several tracks are resting, the one dormant longest is offered.

- **Pick it up** makes the track not dormant for four weeks, so its next lesson
  comes from the following top-up. If it is still not used when the four weeks
  run out, it is dormant again from then and offered two weeks later.
- **Not now** holds the offer back for four weeks.
- **Let it rest** stops the offers for that track until it is used again: a
  question answered or a lesson taken after the press.

Each press is a row in `learn.track_offers` with `kind = 'resting'` and the
track's subject id (learn 0057). Nothing records that the card was shown.

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

### A goal's track is outlined whole

Plan #1139. A learning goal's track gets every unit in one call when the goal
is saved, so the whole course shows from the start. The count follows the
goal's depth: 5 to 8 units for familiar, 8 to 12 for solid, 12 to 16 for deep
(`OUTLINE_UNITS` in `lib/learn/graph/curriculum-payload.ts`). A track that
already had units keeps them, and the outline is written after them.
`learn.subjects.outlined_at` records that a track has its outline (learn 0072).

No unit is written one at a time for an outlined track: the top-up raises no
`all-units-done`, `last-unit-short` or `no-curriculum` need for it. A goal's
track that has no outline yet, because the call failed when the goal was saved
or the goal was set before outlines, raises `no-outline` instead, and the top-up
writes the outline (`ensureOutline` in `lib/learn/lessons/outline.ts`). Tracks
not made from a goal still get their units as they go.

### A goal's units are split into pieces

Plan #1140. Each laid-out unit of a learning goal's track is split into 3 to 6
pieces, each one sitting of about 20 to 30 minutes covering a few of the
unit's ideas, in a suggested order. A unit with fewer than three ideas gets
one piece per idea. The order is a suggestion: nothing is locked by it.

The ideas split are the unit's own, by the rule the unit check uses: its
goals and everything they rest on that no earlier unit's goals also rest on,
whatever the person knows of them (`unitIdeas` in
`lib/learn/lessons/pieces-payload.ts`). Every idea falls in exactly one piece.
One Sonnet call per unit groups them (`writePieces`); an idea the model leaves
out goes in after the idea before it, so the call is not paid for twice.

Pieces are stored in `learn.plan_pieces` (learn 0073): the unit, the piece's
place in it, a title, the ideas it covers as `concept_ids` in teaching order,
and `passed_at`, set when its practice and its check are both passed.
Progress on a plan is the count of pieces passed.

They are written in two places, both in the hourly top-up. When the top-up
lays out a goal track's unit, it writes the unit's pieces straight after. And
on every run, whether or not the deck is short, a pass finds laid-out units of
goal tracks with no pieces and writes up to two (`writeDuePieces` in
`lib/learn/lessons/pieces.ts`). The pass covers units laid out any other way,
such as by opening the unit on the track page, and the units laid out before
pieces existed. Tracks not made from a goal get no pieces.

### A piece is worked through on its own page

Plan #1141. Each piece opens at `/learn/s/[id]/p/[piece]`, linked from its
unit on the track page. Any piece opens at any time; the suggested order locks
nothing. The page shows the piece's lessons one after another, in the order of
its ideas, then its practice task, and ends with its check.

A lesson is the same stored card whether Learn now or the plan reached the
idea first: one `lesson` row in `learn.feed_cards` per concept. An idea with no
lesson yet has it written when the piece is opened, one idea after another,
first idea first, by the same Sonnet call the top-up makes
(`writeLessonCard` in `inngest/learn/lesson-top-up.ts`). An idea the writer
declined shows its claim and the reason.

The check is one question needing the piece's ideas together, answered from
memory in a sentence or two. Haiku writes it when Ask me the question is
pressed and marks what is written, as the unit check does
(`lib/learn/lessons/write-piece-check.ts`). Each question asked is a row in
`learn.piece_checks` (learn 0074) with the answer expected, what was written,
the mark and the marker's sentence on it. The expected answer stays on the
server until the question is answered.

A right answer marks each of the piece's ideas tested: sharp stays sharp and
every other state becomes known, since the answer needed the idea. It sets the
piece's `passed_at` only when the practice is passed too (plan #1142). A wrong answer says what it was missing, shows the
answer expected, and offers another question, written knowing the ones already
asked so it is not the same one reworded. Nothing on the page marks a piece
passed any other way.

### A piece has a practice task

Plan #1142. Between a piece's lessons and its check sits one hands-on task,
such as working out net revenue retention from a small table or laying out a
cohort grid. The piece is passed only when a hand-in for the task meets every
point and the check is answered right, in either order. Nothing on the page
marks either one done by hand, and nothing locks: the check can be answered
before the practice.

Sonnet writes the task the first time the piece's page opens, from the piece's
ideas and whichever of its lessons are written (`writePractice` in
`lib/learn/lessons/write-practice.ts`). A task has its text, an optional table
of at most 8 columns and 12 rows, up to six key figures to type in by name,
two to six points a complete hand-in has, and a worked answer. A point that
checks a figure states the expected value and how close counts. One task per
piece, in `learn.piece_practice` (learn 0075).

Hand-in is typed into the page: a box for each named figure and a box for the
working. Haiku marks it point by point (`markAgainstPoints` in
`lib/learn/lessons/mark-points.ts`), each point met or not with one sentence
to the person: what they got right, or what is missing and where to look,
without giving the expected figure away. Every point met passes the practice.
Each hand-in is a row in `learn.piece_practice_handins` with its marks, and a
hand-in that misses a point can be revised and handed in again. The points and
the worked answer stay on the server until the practice is passed; then the
worked answer can be opened.

A skill normally done in a spreadsheet, such as a revenue bridge or a
financial model, still gets a task that can be typed in, and the writer says
in `spreadsheet_note` what the typed version leaves out. The page shows that
note under the task. Whether typing the key figures is enough for those
skills, or a file Dash reads is needed, is still open: the notes the first
real tasks carry are the evidence for it.

### The plan page

Plan #1143. A learning goal's track page, `/learn/s/[id]`, opens on the
goal's plan. It shows how many pieces are passed out of the pieces written,
with a bar, then a Next up card for the first piece not passed in the
suggested order, then every unit with its pieces. Each piece links to its own
page whatever comes before it. A piece with its practice or its check passed,
but not both, says which half is left. A unit whose ideas are not laid out yet
says it is not split yet. The graph of each unit's ideas, and the forms that
open a unit or go deeper in one, sit in a fold below the plan.

Progress is the count of pieces passed, read from `plan_pieces.passed_at`.
Next up is worked out in `planProgress` (`lib/learn/lessons/plan-view.ts`),
and the reads are in `lib/learn/lessons/plan-store.ts`. A piece skipped
earlier becomes Next up again once the pieces after it are passed.

Learn now lists each plan above the deck, with its progress and a link to its
Next up piece, and each goal on the Goals page links to its plan.

A goal's lessons live on its plan, so Learn now deals none of them. The
chooser gives a goal's track no lesson slot, and the deck and the count that
decides when it is topped up leave out `lesson` cards whose track is an active
goal's (`lib/learn/feed/plan-lessons.ts`), which covers lessons written from
a piece's page. The unit check of a goal's track still comes in Learn now.
Archiving the goal returns its lessons to the deck, since the track is then an
ordinary one.

Nothing waits on Learn now to lay out a goal's next unit any more. On every
hourly run, whether or not the deck is short, the top-up lays out the first
unit with no ideas of up to two goal tracks and splits each into pieces
straight after (`layOutPlans` in `lib/learn/lessons/plan-layout.ts`). A plan's
units are all laid out a few hours after its outline is written. A track whose
layout failed is held for a day, as the lesson top-up holds one.

### Changing a plan

Plan #1144. Each unit on the plan has a menu to move it one place up or down,
or to remove it. Below the units is one line to add a unit by name. The plan
renumbers its units after every change, and Next up follows the new order
because it is read from unit order.

A unit with a passed piece can be moved but not removed, and its menu offers
no remove. Removing any other unit asks once, in place, since it takes the
unit's pieces with it and anything handed in for them. A goal still open under
the removed unit is marked abandoned so its chain is no longer laid out as
part of the plan. The ideas in that chain stay in the track, with whatever the
person has shown about them.

An added unit goes at the end of the plan, where it can be moved like any
other. The person's title is kept as typed, and Dash writes what the unit
covers and its outcome in one Sonnet call, recorded as `write-curriculum`.
Without a key, or when that call fails, the unit is kept with its title
alone, as a custom track keeps the units a person wrote. Its pieces come when
the hourly plan pass reaches it, and until then it says it is not split yet.

The writes are three functions in the learn schema
(`supabase/migrations-learn/0076_plan_unit_edits.sql`): `move_curriculum_unit`,
`remove_curriculum_unit` and `add_curriculum_unit`. They check the unit or
track is the caller's, lock the track so two edits to one plan run in turn,
and renumber the units in one transaction, which the unique ordinal needs. The
table still grants a signed-in user no update or delete, so these are the only
way to change a unit. The calls are in `lib/learn/lessons/plan-edit.ts`.

### Passed pieces come back as review questions

Plan #1145. When a piece is passed, each of its ideas goes on a review
schedule, with its first question due the next day. A right answer moves the
next question further out, through gaps of 1, 3, 7, 16 and 35 days and then
doubling up to 180. A miss brings it back the next day and marks the idea
shaky. A right answer leaves it known, or sharp if it was sharp. Either way
the idea is marked tested. An idea already on the schedule from an earlier
piece keeps the gap it has.

Due questions show in two places. Learn now lists up to five above the plans,
most overdue first, each naming the plan and piece it came from. A piece's
page opens with up to two from the same plan, leaving out the piece's own
ideas. A row starts with the idea's name and Ask me. Haiku writes one question
from the idea's claim, told the questions already asked on it, and marks the
answer as a piece's check is marked (`lib/learn/lessons/write-review.ts`). The
spend kinds are `write-review-question` and `mark-review-question`. A question
asked and not answered is shown again rather than written twice.

The schedule is two columns on `learn.concept_state`: `review_interval_days`
and `review_due_on`, a UTC date. The questions are rows in
`learn.review_questions` (`supabase/migrations-learn/0077_idea_reviews.sql`).
The rules are in `lib/learn/lessons/review.ts`, the reads and writes in
`review-store.ts`, and the presses in `app/learn/review/actions.ts`. Reviews
are not feed cards, so the deck and its top-up do not deal them.

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
  purpose. Their card share was one lesson slot in three until plan #1143
  moved a goal's lessons onto its plan.
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
| A goal unit's pieces | Once per laid-out unit of a goal | about 1¢ |
| A unit check marked | When one is answered | 0.2¢ |
| A piece's question written | On Ask me the question, and each retry | about 0.2¢ |
| A piece's answer marked | When one is answered | 0.2¢ |

A lesson is written only for a concept that is about to be served, so nothing
is thrown away after writing. About half of the sections picked today are.

## Step 1 as built

Plan #978, on 25 September 2026. Code: `lib/learn/lessons/top-up.ts` for the
order of work, `inngest/learn/lesson-top-up.ts` for the reads and writes, and
`inngest/learn/feed-top-up.ts`, which runs it before any section card.

**How the top-up shares the slots.** The top-up counts the ready cards first.
When fewer than its threshold are ready, it asks for lessons for four in five
of the cards it is short, rounded, and then tops up to the target with section
cards. Section cards also fill whatever the lessons fell short of, so someone
with no track that has anything to teach gets a feed of section cards, as
before. This runs in the hourly top-up and in the one after a response on the
feed page.

**Which concepts.** The chooser (`lib/learn/lessons/choose.ts`, plan #975)
names the concept for each slot, as "The next lesson in a track" describes,
sharing slots by track weight. Two details differ from the sections above. A
track counts as dormant when its Practice Flow weight has stopped, which also
needs other tracks used in the four weeks, and a track never used at all is
not dormant, since nothing yet records a track being opened. And a concept
counts as already carded once any lesson row exists for it, including one that
was dropped, so a lesson the source contradicted is not paid for again every
hour.

**Laying out units.** When a track's first unit that is not done has no chain,
the top-up lays one out with `layOutNextUnit` (plan #977) and then asks the
chooser again, so the new concepts can be taught in the same run. At most two
units are laid out in one run, side by side, and only with at least ninety
seconds left before the deadline. When laying one out fails, or finds no unit
to open, the track's `lessons_held_until` is set a day ahead and the top-up
does not try again before then; its ready concepts are still taught. A track
with every unit done, or with no curriculum, gets its next unit written first
(see "Step 3 as built").

**Writing a lesson.** For each concept the top-up searches the catalogue for
the closest section (`findLessonSource`), writes the lesson (`writeLesson`,
plan #976), and records the spend under `embed-lesson-claim` and `write-lesson`. The
lessons are written four at a time. Each is stored as a row in
`learn.feed_cards` with reason `lesson`: the track in `subject_id` and
`track_name`, the unit in `unit_id` and `unit_title`, the concept in
`concept_id` and `idea_name`, and the section it cites in `source_item_id` and
`source_segment_id`. A lesson the model would not write, or whose source
contradicts it, is stored as dropped with the reason. A call that failed stores
nothing, and the concept is chosen again on a later run. One lesson row is kept
per concept, so two top-ups running at once cannot both serve it.

**The card.** A lesson is titled by its concept's name, with "Track · Unit"
under it. The line above the title is built in code: "Next in your Economics
track. It builds on Supply and Demand." When the lesson cites a section, the
card folds the section's text under "Read the section" and links to it, and
Save saves that section to a reading list; with no section there is neither,
and no Save button. Test me on this opens the track's Practice Flow and marks
the card tested. In the deck, a track counts as a lesson's article, so two
lessons from one track are spaced as two cards from one article are.

**What a swipe does.** Got it and Work on this set the concept's state on your
word, and Not now leaves it, through the same step idea cards use
(`settleIdeaFromSwipe`). A lesson comes back after two or three days as other
cards do. The swipes also move the track's weight (`loadTrackInterest`): Got it
and Work on this count as answering one of its questions, and Not now as moving
past one. Only a lesson's latest swipe counts. The track's page names the
lessons behind its weight. Too hard adds a prerequisite from step 4 on.

**Section cards.** The section picker leaves lesson rows out of what it reads,
so lessons do not use up a theme's, field's or goal's turn and do not set how
deep the next pick goes. It does not yet steer clear of subjects a track
already covers.

## Step 3 as built

Plan #969, on 25 September 2026. A new track's curriculum call
(`writeCurriculum` in `lib/learn/graph/curriculum.ts`) asks for the first three
or four units, and the reader keeps at most four and refuses fewer than three.
Units a person writes for a custom track are all kept, up to twelve, as before.

The chooser (`planTrack` in `lib/learn/lessons/choose.ts`) names three needs
that a unit meets: every unit done, no curriculum, and `last-unit-short`, which
is a track on its last unit with fewer than three of that unit's concepts left
to learn. That track still teaches what is left. For each, up to two a run, the
top-up calls `addNextUnit` (`lib/learn/lessons/add-unit.ts`) before it lays out
any chain. It writes one unit with `writeNextUnit`, given the units so far, the
concepts known or sharp, the concepts left shaky, and the lessons from the
track rated too hard, and appends it at the next ordinal. The need carries the
track's last unit when it was read, so a unit another run added meanwhile is
not added twice. A call that fails holds the track for a day, as a failed
layout does. The spend is recorded as `write-next-unit`.

A unit written for a track with every unit done has no chain yet, so the
chooser then asks for it to be laid out, which can happen in the same run. A
unit written ahead of a short last unit waits until that unit is done.

## Step 4 as built

Plan #970, on 25 September 2026. Rating a lesson Too hard only records the
rating, as before. The Learn now top-up (`writeLessonsFor` in
`lib/learn/lessons/top-up.ts`) then starts each run by taking up to two lessons
rated too hard that have had nothing added under them, before it chooses any
lesson. For each, `addLessonFloor` (`lib/learn/lessons/add-floor.ts`) makes the
call a probe makes for a missing floor (`proposeFloor`), given the concept and
the names of the rest of its track, and saves what comes back under the
concept with `saveChainInto` and no goal. The prerequisite may be a new
concept or one the track already holds; either way it has an edge to the
concept. There is no approval screen, as with a unit the top-up lays out. The
spend is recorded as `add-lesson-floor`.

The card records when this was done in `feed_cards.floor_at`, set before the
call, so a lesson gets a prerequisite once: two runs at once do not both add
one, and taking the rating back and giving it again adds nothing. A call that
fails sets it back, so a later run tries again. A call that finds nothing
missing, or a concept known by then, leaves it set.

The concept now has a prerequisite that is not known, so it is no longer
ready. The chooser (`planTrack`) reads which concepts have a lesson rated too
hard and puts the ready concepts under any of them that is not yet known ahead
of the rest of the unit, whatever their distance from the outcome. So the next
lesson written for that track teaches the prerequisite. Lessons already in the
deck from that track are not moved.

## Step 5 as built

Plan #971, on 25 September 2026. Code: `lib/learn/lessons/unit-check.ts` for
which unit is due, `lib/learn/lessons/write-unit-check.ts` for the two Haiku
calls, and `answerUnitCheck` in `app/learn/now/actions.ts` for the answer.

**Which unit.** The chooser reports, for each track that is not dormant, the
last done unit before the first that is not, when it has no check card yet.
Only that one, so a track with several units done before checks existed gets
one check. The unit's concepts are its goals and what they rest on that no
earlier unit's goals rest on, less any not known or sharp. A unit with none
of its own gets no check.

**Writing it.** The top-up writes up to two checks a run, before any lesson,
recorded as `write-unit-check`. Each is a row in `learn.feed_cards` with reason
`unit_check`, the track in `subject_id`, the unit in `unit_id`, the question
in `check_question`, the expected answer in `check_answer`, and the unit's
concepts in `check_concept_ids`. One check per unit, so a unit is offered its
check once whatever became of it. A check the model would not write is stored
as dropped, and a failed call stores nothing so a later run tries again.

**On the deck.** A ready check is dealt ahead of the rest of the pool, spaced
from its track's lessons as two lessons are. The card shows the unit, its
track, its outcome and the question, with a box for the answer. It has no
swipes. Skip records it as dismissed. Check my answer has Haiku mark the
answer against the unit's outcome and the expected answer, recorded as
`mark-unit-check`; the card is then `tested` with the answer, the mark and
its reason on the row, and shows the mark and the expected answer. A right
answer sets `established` to tested on each of the unit's concepts still
known or sharp. A wrong one changes nothing about them.

## Step 6 as built

Plan #972, on 25 September 2026. Code: `lib/learn/lessons/aim-tracks.ts`, and
the goal share in `chooseLessons` (`lib/learn/lessons/choose.ts`).

**The track.** Each open goal records its track in `aims.subject_id` (learn
0056). Saving a goal places it, then gives it a track found or made by the
goal's name, copies the goal's placement onto the track when the track has
none, and writes the track's first units from the goal's line and depth
("city design, as a learning goal: enough to use it and explain it"); since
plan #1139 that is the track's whole outline. The Learn now top-up gives a
track to any active goal still without one before it chooses lessons, with no
model call, and then writes that track's outline. Archiving a goal leaves its track as
one of your tracks, without the goal's share. Rewording a goal leaves the
track's name.

**The share.** The tracks of active goals share one lesson slot in three
between them, counted over the lessons waiting in the deck and the slots filled
in the run, by the rule the section draw used for goals (`wantsGoal`). Within
that third, and among the other tracks for the rest, slots go by weight as
before. When only goal tracks have something to teach they take every slot,
and when none of them has, their third goes to the other tracks. A goal's track
is never dormant while the goal is active.

**Section cards.** The section draw no longer takes open goals: only the
Level 3 goal is drawn there, from its list, and it now has the goals' one
section card in three to itself. A goal linked from a life goal counts its
track's lessons and checks as its cards read.

## Build order

Each step ships on its own.

1. **Lessons for track concepts.** Built (plan #978). The top-up writes lessons
   for the ready concepts of tracks you already have, by track weight, with
   exploratory cards at one in five. Swipes set the concept's state.
2. **Track offers in the feed.** Built (plan #968). One offer a visit, chosen
   as Practice Flow chooses it and shown after the second card; Start writes
   the track and its curriculum, and Not now and Never go through Practice
   Flow's own action. "Make this a track" on a section card makes the article a
   track with a curriculum, and the top-up lays out its first unit. The offer,
   and a resting track offered back, later moved out of the feed onto Tracks
   (note 8a1789df), at the top of the page.
3. **Units written as you go.** Built (plan #969). New tracks start with three
   or four units, and a unit is added when a track runs short.
4. **Too hard adds a prerequisite.** Built (plan #970). The top-up adds what
   a lesson rated too hard rests on, and teaches it next in that track.
5. **The unit check.** Built (plan #971). A done unit's check is the next
   card from its track; skipping it leaves the unit done, and a right answer
   marks its concepts tested.
6. **Goals as tracks.** Built (plan #972). An open goal on the Goals page
   gets a track, and the goals' tracks share one lesson in three.

## Settled questions

- The Level 3 goal stays a source of section cards, drawn from its fixed list,
  with no track and no units (decision #973). It has the goals' one section
  card in three to itself.
- A dormant track is offered back as a card two weeks after it goes dormant
  (decision #974, built in plan #1045), as "A resting track is offered back"
  describes.

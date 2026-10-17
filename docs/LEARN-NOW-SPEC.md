# Learn now

Learn's first tab, at `/learn/now`. It opens on today's piece of a prepared
subject and a press to practise across your prepared subjects. Beside them is
a short list of what is waiting for you and of the subjects Dash is still
preparing. There is nothing to swipe. The endless deck of cards this page used
to be survives as Cards, a page of its own that ends when the last card is
answered.

Until plan #2313 the page was that deck: cards drawn from Wikipedia sections
for the themes you write about, with survey questions and goal questions mixed
into Practice Flow. A subject you add is now prepared by Dash, with its
syllabi, topics and first lessons (LEARN-LESSONS-SPEC), so the page no longer
has to go looking for something to put in front of you.

Written to [WRITING-GUIDE.md](WRITING-GUIDE.md). The owner decided the deck on
23 September 2026 and its replacement on 17 October 2026.

---

## The page

Now is one main column with a rail beside it, and the rail follows the main
column on a phone (`app/learn/now/now-view.tsx`). The main column holds, in
order:

1. Today's piece, when there is one.
2. The Practice card: the number of prepared subjects and a Start practising
   press. With a piece on the page the press is quiet. With no piece the card
   says "No piece is waiting today" above a primary press, so a missing piece
   does not read as one that failed to load.
3. Under the press, the topics Dash researched for you (briefs), the readings
   you queued ("You said you would read these"), and the ideas due for review.

When there is no piece and no prepared subject the Practice card is replaced by
an empty state. It says Dash is still preparing your subjects when a
preparation is running, and otherwise offers Add a subject, which goes to
`/learn/know`.

The rail holds Waiting for you, Preparing, and what Dash did today in Learn.
When the first two are empty the page is one column and Dash's day follows the
main column. One read failing never fails the page: a count that cannot be
read drops its own line, and a list that cannot be read comes back empty.

A switch in the page header, Today and Practice, moves between the two views
by a search parameter, so the choice survives a reload and the back button.

## Today's piece

A piece is one sitting of about 20 to 30 minutes in a unit of a prepared
subject or of a learning goal's subject (LEARN-LESSONS-SPEC, "A goal's units
are split into pieces"). Now shows the lessons of the next piece you have not
finished, and then its check. A right answer to the check finishes the piece
on Now. The practice task stays on the piece's own page, and the piece passes
only when that is handed in too.

Which subject: the one whose piece check you last answered, so a course you are
in the middle of keeps you there, and with none yet the oldest. A subject whose
pieces are all finished on Now gives way to the next. A subject that has no
pieces written yet is reported as such when no subject has a piece to give, and
Now points at its page. A piece named in the link (`?piece=`, which the morning
notification writes) leads when it is one of yours and not finished. The
choice is `chooseTodaysPiece` in `lib/learn/lessons/todays-piece.ts`, and the
reads are in `todays-piece-store.ts`.

The piece has a conversation with Dash under it, in which the check is
answered and marked. Its turns are kept against the piece, not on Now.

## Practice

Practice is the same address with the switch on (`/learn/now?practice=1`).
`/learn/flow` redirects there with its query kept, and so does an old link
carrying `goal` or `only`.

Every question is about one level of one topic, chosen by
[LEARN-LEVELS-SPEC](LEARN-LEVELS-SPEC.md), "Choosing the next question":
placement on a topic you have not been placed on, then the fringe with misses
first, and a re-check one answer in five. The answer screen lists every level
the answer reached. Nothing else is asked. Since plan #2313.2 no survey
question about a theme from your notes is written, no goal question is written
ahead, and no hidden subject is made to hold either. The survey answers
already given still count on the Know grid.

Unfocused, the topics are those of every subject whose preparation has
finished and every subject an open goal points at (`practiceSubjectIds` in
`lib/learn/levels/practice-store.ts`). A filter at the top chooses between
them:

| Filter | What it asks about |
|---|---|
| Everything (`?only=all`) | Prepared subjects and goals' subjects |
| Subjects only (`?only=tracks`) | Prepared subjects alone |
| Goals only (`?only=goals`) | The subjects your open goals point at |

With Goals only on in Learn settings, the bare address opens on Goals only and
`only=all` gets past it.

Three links narrow the questions further:

- `?track=<subject id>` asks about one subject, and the filter is replaced by a
  line saying so with a way back to all subjects. An id that is not a subject
  of yours goes back to the plain flow.
- `?goal=<aim id>`, a goal's Practise link, goes to the subject the goal points
  at, or to the plain flow for a goal that points at none.
- `?placement=1` with a subject asks up to eight placing questions on its lens
  and ends on its first lesson (plan #2292.2).

A run is the questions since a time the links carry from one question to the
next. End run, or running out of questions, shows what moved in it, and may
offer a lens for a theme the run missed. Nothing about the run is stored. When
every level you are ready for has been asked about recently the page says there
is nothing left to ask.

## What is waiting

Waiting for you lists, in this order and each only when its count is above
zero: things in the Learn inbox, ideas due for review, readings you said you
would read, and cards from before. Each line links to where you deal with it.
The reviews and readings lines jump to their lists lower on Now. The cards line
goes to Cards and goes away with the last card.

A count that could not be read drops its line. If any could not be read and
none shows, the list says so rather than claiming nothing is waiting. Goals
without a plan are no longer counted: a subject you add is prepared on its
own, so a goal has nothing to wait on you for here (`lib/learn/feed/waiting.ts`).

## Preparing

A subject whose preparation has not finished is listed with the step its run is
on ("Find syllabi and other structure documents", "Lay out the territory", and
so on), linking to the subject's page. The line is `preparationLine` over
`preparationView` in `lib/learn/prepare/view.ts`, the same words the subject's
page uses. The list is drawn only while a run is unfinished. The steps and what
they do are in LEARN-LESSONS-SPEC.

## Cards

Cards are the old deck, at `/learn/now?cards=1`, one at a time with the three
swipes below. They are the cards written before Now changed, and the page says
so. It ends when none is left. Nothing on Now asks for more, and Generate more
is gone. A morning notification that names a card (`?card=`, plan #2164.7)
opens Cards on that card.

`/learn/now?track=<subject id>` without the Practice switch is one subject's
cards, opened from the subject's page, with a link back to it. Its other side
of the switch is Practice on that subject.

The rest of this document describes the cards: what one is, how it was and
still is made, and what swiping it does. The hourly top-up
(`/api/cron/feed-top-up`) still tops up a person who has placed themes and
fewer than twenty ready cards. It writes no card or concept lesson for a
subject whose preparation has finished, which the preparation covers (plan
#2297.4). 
A card shows up to two of your own notes on its idea (plan #1113). For the
first cards the lookup starts on the server and is passed down unawaited, one
promise a card, so the card paints first and the notes stream in under it.

The readings you queued yourself were once served first in the deck. They are
now a list on Now under the Practice card.

## Two rules this overturns

[LEARN-SPEC.md](LEARN-SPEC.md) was written for a reading queue, and two of its
rules do not hold for cards. The owner has set both aside for them:

- **"Not a reader."** A card shows the source's own text on the card where
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
| Actions | The three swipes below, Save (to a reading list), Not interested, Test me on this |

"Test me on this" starts a subject from the card and opens Practice on it. It
is the one bridge from a card to Practice, and it is always optional.

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

[LEARN-LESSONS-SPEC](LEARN-LESSONS-SPEC.md) replaces this with lessons written
for the concepts in your tracks, decided on 24 September 2026. Since plan #978
the top-up gives about four in five of the cards it is short to lessons (that
spec, "Step 1 as built"). What follows is how the rest are made: the
exploratory cards, and every card for someone with no track that has anything
to teach.

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

The hourly run tops up anyone with fewer than twenty ready cards. It writes the
picked rows first and picks more targets only when they run out. Since plan
#2313.1 a response on Cards no longer starts a top-up, and the page has no
Generate more.

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
other actions. Cards still ready stay in the pool while they are on the screen, so the page keeps the
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
ready cards newest first, then returning skipped ones, spaced out as "The
order of the deck" describes.

### The order of the deck

Decided by the owner on 24 September 2026, the day ideas went in, after three
cards in a row from "Tell (archaeology)". A section's ideas are written at the
same moment, so newest first served them back to back, and picks for one theme
arrived together the same way (three geopolitics cards in a row).

A page of the deck is dealt from a pool four times its size, in the order
above. Each next card is the first in that order that shares no article with
the last four cards dealt and, where possible, is not for the same theme or
goal as the card before it. When every card left clashes, the one whose article
was seen longest ago goes next. The page sends the ids it already holds in deck
order, so the spacing carries on from one page to the next. A lesson counts
its track as its article and the track as its target, so two lessons from one
track are kept apart the same way. Code: `lib/learn/feed/spread.ts`, with the
lesson rule in `spreadOf` in `lib/learn/feed/load.ts`.

## One idea per card

Decided by the owner on 24 September 2026, after a card on "Startup company:
Failure". The card read as a summary of the section. It gave a paragraph to who
PwC is and what a startup studio is, because the section names them. It also
packed four loose points into one card: failure rates, the causes of failure,
founders blaming the wrong cause, and patents. A Wikipedia section is the
source. The card should teach one idea from it.

### What an idea is

An idea is one claim that can be stated in a sentence and tested: "Startups
that run out of money have usually run out of demand first." A definition, a
statistic with nothing to explain, or a passing mention is not an idea. A
section holds between none and three ideas worth a card. "Startup company:
Failure" holds two: that demand fails before cash does, and that the founding
team predicts failure more than the product does. The failure-rate range is
evidence for the first, and the line on patents is dropped.

### How a section becomes cards

The writing call (step 4 of "How cards are made") still reads one section per
picked row, and is still the one call that decides whether the section serves
its target. It now lists the section's ideas, at most three, and writes a card
for each in the same call, so the section is read once however many cards come
out of it.

Before the call, the ideas this person has already met that sit nearest the
section are looked up by embedding, and their claims are passed in. The call
writes no card for any of them. After the call, each new claim is embedded, and
one within a very short distance of an idea already held is taken as the same
idea: the card is dropped rather than shown twice.

The first idea's card is written onto the picked row. Each further idea gets a
row of its own, on the same section and target, numbered by `idea_index`.

### What an idea card carries

| Part | What it is |
|---|---|
| Title | The idea's short name, two to six words ("Demand fails before cash"). The article and section are named under it, as the source. |
| Takeaway | The claim itself, in one plain sentence. |
| Context | Only what the claim needs to be followed: the terms it uses and the one or two facts it rests on. No person, organisation or term the rest of the card does not use. |
| Evidence | The concrete number, case or result from the section that supports the claim, in the place the hook had. |
| Why it holds | Two or three sentences on the mechanism, from the section. Where the section gives a result without its reason, the well-established reason may be given. |
| In practice | The idea applied to one specific case, as before. |
| Try this | A question that makes you use the idea, as before. |

### Where ideas are kept

Each idea is also a concept in `learn.concepts`, with `origin = 'feed'`, its
claim embedded in the concept's `embedding` column. Every concept must belong to
a subject, and since plan #2313.2 that is always one you chose and never a
hidden one made for the card. In order, it is the subject the card was written
for, the subject its goal points at, and a subject of yours named after the
article. A card with none of these keeps its idea on the card and saves no
concept. Each saved idea is attached at once to its nearest frame topic
(`attach_idea_topic_parent`, learn 0179). Pressing Test me on this starts a
subject named for the article when you have none, and the ideas already filed
under it are its first.

The swipes set the idea's state in `learn.concept_state`, on your word:

| Swipe | State | Established |
|---|---|---|
| Got it | `known` | `declared` |
| Work on this | `shaky` | `declared` |
| Not now | unchanged | |

A state that a test established is never overwritten by a swipe.

This is what later picking builds on: which ideas under a subject are known,
which are shaky, and which have never been met. Choosing the next pick from the
unknown ideas under a concept, and a reading made of several ideas in order
that ends in a written answer, are the next two steps and are not built yet.

Cards written before this carry no idea name. They are shown as before, titled
by article and section, until the top-up has replaced them.

## Explaining a phrase (plan #1057)

Select a word or phrase anywhere on a card, including in Dash's answers under
Ask about this card, and an Explain button shows above the swipes. Dash
explains it in three to five sentences: what it means, then how it connects to
the card. The same Sonnet call names the English Wikipedia article that
teaches the phrase. The explanation is kept in `learn.phrase_explanations`
against the card and the phrase, so selecting it again costs nothing.

Under the explanation, Make it a card fetches that article, picks the section
the call named (the lead when it is missing) as a row with the reason `asked`,
and writes it while you wait with the top-up's own writer. The card goes next
in the deck, its why line names the phrase, and its idea is saved as a concept
like any other. A write that fails leaves the row picked for the next top-up.
Start a track makes a reading track on the phrase, as the new-topic page does.

### Underlined ideas (plan #1056)

The call that writes a card also names up to three other ideas the card leans
on, each as words the card already uses and one line on why it matters to the
card. They are kept in `feed_cards.mentions`, and any phrase the card does not
contain, or that is the card's own name, is dropped before it is stored. The
card underlines each one where it is first read, in the takeaway, the context,
the evidence, the reasoning or the example. A tap opens the same explanation a
selection does, with no selection needed, and is kept as an ordinary
`learn.phrase_explanations` row. The underline's tooltip carries the why line.

This costs no extra call. Cards written before it, lessons and unit checks
carry an empty list and show no underlines; selecting a phrase still works on
all of them, and old section cards gain underlines only as the top-up replaces
them.

## Explaining an idea back (plan #1054)

Every so often the deck gives you an idea you kept and asks you to explain it
to a friend in a few sentences. Kept means swiped known or "work on this", or
saved, at least three days ago. The idea kept longest ago goes first, leaving
out one asked about in the last thirty days and one already sharp.

The card is a row with the reason `teach_back`, written by the top-up with no
model call once enough other cards have been written since the last one. The
rate starts at one card in ten and is kept in `learn.settings`
(`teach_back_every`); the menu at the foot of the card offers one in five,
ten, twenty or forty, or never. A teach-back still waiting to be answered
holds off the next.

What you write goes into the card's conversation (`core.conversations`). Haiku
marks it against the idea's claim and basis: what was right, what was missing,
and whether you gave an example of your own. The same call writes one
follow-up question, which you answer in the same thread and which is marked
too. The marks are kept on the card in `feed_cards.teach_back`, and each answer
is kept as a question at the defence rung in `learn.probes`, so the idea's
page lists both.

Teach-back is the defence rung (#1055). An explanation that does not hold
leaves the idea shaky. One that holds makes it known straight away, and
holding through the follow-up makes it sharp. The claim is shown once the
exchange is over. Like a unit check the card has no swipes: it is answered or
skipped, and Ask and phrase explanations are not offered on it, since its
conversation is the answer being marked and its claim is the answer.

## Cost

Two model calls per card, one to name the material (Haiku, about 230 tokens
out) and one to write the card (Sonnet, a few hundred tokens out). Twenty cards
is a few cents.
Recorded in the spend ledger under their own operations.

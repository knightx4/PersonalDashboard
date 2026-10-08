# Checking screens while they are built

This spec moves the app's UI checks from after a screen ships to while it is
being built. A step that adds or changes a screen draws it in the preview
gallery first, photographs it at phone width, and cannot merge until a
separate design critic has looked at the pictures and passed them. The
person's own preferences, taken from their notes, are written down where the
critic reads them, so each correction applies to every later screen. Scripted
checks catch what a still picture cannot, and the person sees each change as a
before-and-after picture.

The design language on `/dev/ui` stays what it is. This spec is about making
the building follow it the first time.

> **Status:** shaped 3 October 2026 into proposed features #1528 (the critic),
> #1536 (phone checks), #1540 (before and after pictures) and #1544 (patterns).
> Part 8, added the same day, is #1548 (motion), #1555 and #1559 (moments)
> and #1564 (judging craft). Part 9, added 8 October 2026, is feature #1653
> (which jobs get a list, a chart or Dash).

## What happens today

The tools are already here. `app/dev/ui/laws.ts` holds 27 design laws, and
`npm run check:ui` holds the ones a search of the code can see, against
`scripts/ui-baseline.json`. `app/preview/surfaces.tsx` renders real components
with fixtures, and `scripts/shoot.ts` photographs every surface at 390 and
1280 pixels in light and dark. The `ui-polish` agent's whole method is "add
the surface, shoot it, look at it, then decide". `/dev/surfaces` shows every
surface with a place to write a note under it.

None of that runs where screens are made. The plan's building reference,
`.claude/skills/plan/reference/building.md`, never takes a picture. The notes
skill does (`npm run shoot -- <surface-id>` before closing), so a screen gets
looked at when it is fixed, not when it is first built. The first version of
each screen is designed by reading code.

The cost shows in the notes. Of the 185 notes filed outside Dev in the 30 days
to 3 October 2026, about 118 are about layout, spacing, visual hierarchy,
loading or reach on the phone. That is a keyword count and overstates a
little, but the share is clear. Many state a general preference on one page:
"links should work... really anywhere like it", "let me collapse the
recommended roles and any similar boxes anywhere else", "I thought it was
clear we are never doing forms like that." The notes skill clusters surface
notes by law and adds a law when none fits, which is the right instinct, but
only after the screen has shipped and the person has filed a note.

Three more causes sit in how steps are written and checked. A done-when says
what a screen does, not how it is laid out, so each step arranges its page
from scratch. The checks that run on every commit are searches of the code,
which cannot see crowding or a weak hierarchy. And screens are judged at
laptop width by default, while the person mostly uses the app on a phone.

## Part 1: Picture before code

Any step that adds or changes a surface builds the surface in the gallery
first. It adds or updates the surface's entry in `app/preview/surfaces.tsx`
with typed fixtures, using the real components, and runs `npm run shoot` for
it at 390 and 1280 in light and dark. Only then does it wire the surface to
real data.

The surfaces a step touches are named in its brief. Nothing maps a page to its
gallery surfaces yet (`lib/feedback/surfaces.ts` only reads notes filed from
the gallery), so each gallery entry gains the routes it stands for, and the
brief lists the surfaces whose routes the step's files serve. The routes are
kept by surface id in `lib/preview/routes.ts` rather than on the entries,
because the brief is written where the gallery's components cannot be
loaded; a test holds the two lists together. The brief lists the surfaces the
step's words name (a page address, a gallery link or a screen file) and, from
the plan CLI, those its changed files serve, following a component's imports
to the pages that use it. A step that
changes a page with no surface adds one. A step that changes no surface
skips this part and Part 2.

## Part 2: The design critic

After building, the session hands the pictures to a separate critic, an agent
defined in `.claude/agents/ui-critic.md`, running on Opus with no part in the
build. The critic is given:

- the before shots, taken from main, and the after shots
- the design laws and the person's preferences (Part 3)
- the pattern the step uses (Part 4) and the step's done-when

It answers with pass, or with fixes. Each fix names what is wrong in the
picture, at which width and theme, and the law or preference it breaks. The
builder makes the fixes, shoots again and hands the new shots back. A step
gets three rounds. After a third failure the step blocks on the person, with
the critic's last fixes, where the shots are and the branch in its ask, and
the person accepts the screen as it is or says what to change (decision 1,
answered A). Saying what to change gives the builder three fresh rounds,
numbered on from 4. `lib/plan/ui-check-stop.ts` writes the ask and
`npm run ui-stop` prints it.

The builder never writes the verdict. Each round is recorded in a table,
`public.ui_checks`, with the step, the surface, the round, the verdict and the
fixes, and the shots are uploaded to a storage bucket so the person can see
them later. `scripts/plan.ts done` refuses to close a step whose commit
changes a `.tsx` file under `app/` or `components/` without a passing check
for each surface it touched.

The critic runs as a subagent inside the build session, so it uses session
time rather than API spend. It adds a few minutes to each step that changes a
screen. The notes skill uses the same critic when a fix touches a surface.

## Part 3: The person's preferences

The laws are general principles. The person also has specific preferences
that a law does not state, such as 12-hour times or one column on a detail
page. These go in `app/dev/ui/taste.ts`, beside `laws.ts`, and show on
`/dev/ui` under the laws. Keeping them in the app rather than a separate
document follows the rule in [DESIGN-UPDATE-PLAN.md](DESIGN-UPDATE-PLAN.md):
`/dev/ui` is the only description of the interface.

Each entry is one sentence, the note or notes it came from, and a surface that
shows it done right. The first entries come from the person's notes of the
last two weeks:

| Preference | From |
|---|---|
| A detail page is one column: details first, then the long text, then the rest. | Role page, 30 Sep |
| The main forward action stays in the same place at phone width, reachable without scrolling. | News, 2 Oct |
| Anything worked through in sequence has the next item loaded before it is asked for. | News, 24 and 27 Sep, 2 Oct |
| A swipe shows the next item coming in as the current one leaves. | News, 2 Oct |
| Adding something is one press, with details after. No form where a button would do. | Learn, 24 Sep; contact, 29 Sep |
| Every URL in any text is a link. | Company and goal pages, 28 and 29 Sep |
| A box that holds a list can be collapsed. | Roles, 28 Sep |
| Pressing a thing's name opens it. It never starts editing it. | Goals, 27 Sep |
| Times are 12-hour with AM and PM, everywhere. | Calendar, 27 Sep |
| Text never sits bare on the background, and the person's words, quotes and Dash's words each look different. | Vault note and Maya, 30 Sep |
| Panels over content are opaque enough to read. | News and Ask, 2 Oct |
| A press that starts loading shows a loading state at once. | Learn, 28 Sep |
| The important thing fits on one phone screen, with no large gap where an image is missing. | News, 24 Sep |
| A row of categories on a phone stays on one line, ending in "More". | News, 30 Sep |

The notes routine adds an entry when a note says the request applies
"anywhere" or "everywhere", or when the same request comes in on two
different pages. It adds the entry and fixes the pages in the same batch. The
person can remove any entry from `/dev/ui`. A press cannot edit `taste.ts`, so
a removal is a row in `public.ui_taste_removals`: the page leaves the entry
out, the session that runs the critic tells it not to cite the entry, and the
notes routine does not add it again. An entry that keeps applying
across workspaces can be promoted to a law by the person.

## Part 4: Page patterns

Most layout problems come from a page being arranged from scratch. A small set
of patterns, each a layout component in `components/patterns/` with a gallery
entry and a short rule on `/dev/ui`, gives a step a shape to start from. The
first three are the shapes the gallery shows most, the fourth was added for
pages that hold several views of one thing, the fifth for overview pages on a
wide screen, and the sixth for pages of peer sections:

- **List and detail**: a list you work through, and one item's page, one
  column.
- **Deck**: one item at a time with a fixed forward action and the next item
  loaded, as Quick read and Learn now work.
- **Thread**: a row's comments and Dash's replies.
- **Tabbed detail**: one thing's page with breadcrumbs, a title, tabs that
  each have their own address, and its properties in a column on the right
  that becomes a grid of facts under the title on a phone. The feature page
  on the plan and the goal page use it (decision 1661, answered B, after
  Linear's project page).
- **Main plus rail**: an overview page such as Home, with the column you work
  in and, from laptop width, a narrow column on the right holding what you
  glance at (counts, what is running, what Dash did, what is due soon). On a
  phone the rail follows the main column. Never on a detail page, which stays
  one column (feature 1624).
- **Tabbed sections**: a page of peer sections looked at one at a time, such
  as Account or a company, shows one behind a row of tabs kept in the
  address, so a refresh and a pasted link return to it. Only the open tab is
  drawn, and folds may sit inside it. A page read top to bottom stays
  stacked, and two or three modes of one view are a segmented control. The
  role page uses it (feature 1624).

A step's detail names its pattern ("Pattern: list and detail"), and shaping
writes it. A screen that fits none of them is a new pattern, which the person
decides on, because every later screen of that kind will follow it. Existing
pages move onto a pattern when a step next changes them.

## Part 5: Checks a picture cannot do

Scripted browser checks in `tests/interaction/` run against the preview build
at 390 pixels wide. Four run on every surface in the gallery:

- nothing scrolls sideways
- every press target is at least 44 by 44 pixels
- nothing a person can press sits under the dock
- text over a panel meets the contrast floor `check:contrast` already uses

Two more run on surfaces of the deck pattern and on links:

- a press shows its pressed or loading state within 100 milliseconds
- the next item's data and image are fetched before Next is pressed

A surface is a deck when its gallery entry declares `deck`, naming its Next
and its item (`lib/preview/deck.ts`); Quick read's story card is the first.
Next is pressed with every new request held, so the next item shows only if
it was already in the page. Each control and link is pressed with motion on,
and passes when anything about it changes within 100 milliseconds: its
`press` scale, a loading label, or the page it opens.

They run in the gate on the surfaces the commit touched, so they add seconds
rather than minutes. `npm run check:phone` serves the gate's own build with
the gallery on and runs them after the Build step, since the lint lane has no
build to serve. A surface's counts are held in `scripts/phone-baseline.json`
as `check:ui` holds its own: a touched surface that measures more than main
fails, and one that measures less writes the lower count back. Main had
about 1,570 press targets under 44 pixels when the checks arrived, so a
check that demanded zero would have failed every screen change.

## Part 6: The person sees pictures

A step that changed a surface shows its before and after phone shots on its
plan row and in the changelog. Under them is a thumbs-down that takes a
comment and reopens the step with it, so the person's correction goes to the
session that built the screen rather than into the general notes queue.
`/dev/surfaces` gains a "Changed this week" filter.

## Part 7: Measuring it

The number that says whether this works is the share of the person's notes
that correct a surface changed in the previous 30 days. A note counts when its
page is one of the routes of a surface that a step changed in that window. `/dev/ui` shows it
by week. It should fall once Parts 1 to 3 are running. If it does not, the
critic's instructions or the preferences are wrong, and they are what to look
at.

## Part 8: Delight

Parts 1 to 7 stop a screen shipping with something wrong with it. They do not
make it a pleasure to use, and the person wants that, with an opinionated
direction. This part gives the app one.

### The direction

Calm and fast, with things that behave like objects. Everything has a place,
and you see it go there: a capture flies into its workspace, a finished todo
settles into the day's pile, a passed story slides off the deck, a closed goal
step settles into the step above it. Done consistently, that makes the app
feel like a place rather than a set of pages.

The numbers and the person's data stay plain, as law 7 already says, and the
voice stays as `/dev/ui` describes it. The expression goes into motion, the
marks, the themes and a few designed moments. The person chose this balance
on 3 October 2026: restrained in the data and the voice, expressive in motion.

The start of this is already in the app. Capture plays a puff and flies a chip
to where the item went (`components/motion/clear.tsx`, `travel.ts`,
`settle.ts`, played in order by `place.ts`). Clearing a worked list draws the
day's sigil, a mark made from the account and the date
(`components/ui/sigil.tsx`, and `QueueCleared` in `components/motion/clear.tsx`),
on Todo, Quick read and the shopping review. A goal closing plays a ring and a fold. What is
missing is a system: each animation has its own duration, they share one
easing curve, nothing springs, nothing responds to touch beyond the swipe, and
sound is listed on `/dev/ui` as "not yet".

### Motion

Shared tokens in `app/globals.css`, mirrored in `lib/motion.ts` for code that
times animations: four durations (instant 90ms, quick 160ms, move 260ms,
moment 600ms), the existing soft ease-out, and a spring written with CSS
`linear()`. Three shared pieces in `components/motion/`, grown from the
capture code: travel (an item moving from one place to another), settle (a
short spring into place, with its name beside it), and clear (a list's last
item leaving and the sigil drawing in).

A swipe follows the finger exactly and springs away or back on release. A
completion buzzes once for 10ms on Android; iPhones give web apps no vibration,
so there it is motion only. A soft completion click, under 80ms, can be
switched on in account settings and is off by default. Every animation has a
reduced-motion version that keeps what it tells the person, as the landing
name already does.

### Moments

A moment is a designed response to something that matters. Each workspace has
at most three, so they stay noticeable. They are listed on `/dev/ui` with
their trigger, what the person sees, their reduced-motion version and whether
they are built yet, from the catalogue in `app/dev/ui/moments.ts`.

| Workspace | Moment |
|---|---|
| Todo | Ticking the last item due today settles the done items into a pile that folds shut, draws the sigil, and says how many were finished. |
| News | The end of Quick read says how many stories were read and skipped and which one held attention longest. |
| Home | The first visit of the day brings the greeting, brief and Today in in sequence; once nothing due today is left, the sigil sits beside the date. |
| Jobs | A role moving forward travels to its new column; an offer has the one larger moment. A rejection fades with no movement and shows how many applications are still open. |
| Goals | A goal closing keeps its ring and fold. A step Dash finished settles in with Dash's mark flashing once. |
| Learn | A concept you now know lights on the map and traces what it unlocks. |
| Shopping | A refund that arrived inside its window counts up into the year's "saved by returning on time" figure. |
| Dash | Its mark comes alive while it works, and its lookups appear as it makes them. |

A fourth moment in a workspace is a decision for the person.

### Judging craft

The critic in Part 2 also judges craft. `scripts/shoot.ts` records each
gallery surface's declared interaction (a press, a swipe, a completion) as a
strip of frames, 50ms apart for up to a second, because the critic reads
images and cannot watch a video. A gallery entry declares its interaction in
its `interaction` field; `npm run record` plays it at 390 pixels and writes
the strip to `.preview-shots/strips/`, beside a JSON file giving each frame's
time and what the finger was doing. Against the strip it checks that a press
shows a response in the first frame after it, that motion follows the finger
and ends settled without a jump, that the moment the catalogue lists for the
screen is there, and that the wording names real counts and things.

A feature whose screens have a catalogue moment gets a last step from
shaping, "Build its moments and pass the craft check", and is not done until
that step is.

## Part 9: Which jobs get a list, a chart or Dash

Part 1 to 8 say how a screen is checked. This part says which screen a job
needs in the first place. A workspace has three kinds of interface for a job,
and each job gets the one that suits it.

**A plain list, with a detail page, is for browsing and for acting on one row.**
Finding an item, reading it, editing a field, marking one thing done, or
checking what a single order or role says. The person is looking at the rows
and decides as they go, so the list is the interface and nothing replaces it.

**A chart in Dash's reply is for a one-off question about totals or trends.**
"What did I spend by month this year?" "How many applications went out each
week?" The answer is read once and does not need to stay on a page. Dash
reads the person's rows, picks the chart that fits the question, and draws it
in the reply. The chart is not saved to a workspace page. Keeping one on a
page is a separate idea and not part of this rule.

**Handing the job to Dash is for changing many rows by a rule.** "Tag
everything from this order as gift." "Mark every role I have not heard from in
a month as stale." The person states the rule and Dash finds the rows. A
change of this kind is one Dash action with one Undo that reverses all of it,
and the reply says how many rows it touched. Selecting rows by hand on the
list stays for a handful of rows the person can see. The line is a rule that
the person would otherwise apply row by row.

**What never goes to Dash.** Deleting rows stays on the list's own bulk bar,
because a delete cannot be undone from a reply. Anything outside the app, such
as sending an email, placing an order or posting, stays a step the person
takes.

### Shopping

- List and detail: inventory and each item, orders and each order, saved
  items, returns, recurring payments, the review queue, selling an item.
- Chart in Dash's reply: spending by month, category or shop; how many items
  of each kind are owned; what returns saved or cost over a period.
- Handed to Dash: tag, categorize or mark for sale every item matching a rule
  such as an order, a shop or an age; set the same field on many items.
- Stays on the list's bulk bar: deleting items or orders.

### Jobs

- List and detail: roles and each role, the pipeline, companies, contacts,
  interviews, the review queue, answers.
- Chart in Dash's reply: applications per week, how long roles sit in each
  stage, where offers and rejections come from.
- Handed to Dash: move, tag or close every role matching a rule such as stage,
  company or days since the last contact; set the same field on many roles.
- Stays on the list's bulk bar: deleting roles.

Other workspaces follow the same rule when a step next changes them. A step
that adds a job to a workspace names which of the three it is.

## Rules

Written in the form [SPEC-LAYER-SPEC.md](SPEC-LAYER-SPEC.md) describes. A rule
whose check is not built yet is marked pending on the plan step that builds
it. R1's baseline was measured on main on 4 October 2026: 72 pages had no
surface. A page that only redirects draws nothing and is not counted, nor are
API routes or the gallery itself.

**R1.** Every page under `app/` has at least one surface in the gallery.
Checked by: count `routes-without-surface`, baseline 72, target 0.

**R2.** No surface scrolls sideways at 390 pixels.
Checked by: test `tests/interaction/no-sideways-scroll.test.ts`.

**R3.** Every press target is at least 44 by 44 pixels at 390 pixels wide.
Checked by: test `tests/interaction/press-targets.test.ts`.

**R4.** A step that changes a surface has a passing design check before it
closes.
Checked by: test `lib/plan/ui-check-guard.test.ts`.

**R5.** Every preference names the note it came from.
Checked by: test `tests/dev-ui-taste.test.ts`.

**R6.** Every animation has a reduced-motion version.
Checked by: test `tests/dev-ui-moments.test.ts`.

**R7.** Animation timings and easings come from the motion tokens.
Checked by: count `raw-motion-values`, baseline 234, target 0.

**R8.** No workspace has more than three moments.
Checked by: test `tests/dev-ui-moments.test.ts`.

**R9.** A list job that changes many rows by a rule is also offered to Dash,
and the change is one Dash action with one Undo.
Checked by: audit.

**R10.** Deleting rows is not offered to Dash in any workspace.
Checked by: audit.

**R11.** A workspace page does not keep a chart that Dash made in a reply.
Checked by: audit.

## Decisions

**1. What happens when a screen fails its third round with the critic?**

- A. The step blocks, with the last shots and the critic's fixes on it, and
  the person decides: accept it as it is, or say what to change. Cost: a
  step can wait on the person.
- B. The step merges, flagged on its row with the shots, for the person to
  look at when they can. Cost: a screen the critic would not pass ships.

Recommendation: A. Three failed rounds usually means the step is missing a
decision, such as which pattern the screen should use, and that is the
person's to make.

Answered A on the plan (#1535). The stop is plan #1609; accepting or
redirecting from the step's row is plan #1610. Accepting writes a round with
the verdict `accepted` for each surface that stopped. Only the person writes
it, and the close guard counts it as passed, so the record keeps who let the
screen through.

## Order of work

1. The preferences in `app/dev/ui/taste.ts`, the critic agent, and the change
   to the building reference and the notes skill. These change every screen
   built from then on and need nothing else first.
2. `public.ui_checks`, the shot uploads, and the guard on `plan.ts done`.
3. The four checks on every surface, then the deck and link checks.
4. Before and after on the plan row, the thumbs-down, and the measure.
5. The three patterns, then the rule that steps name one.
6. The notes routine adding preferences.
7. The motion tokens and shared pieces, then the moments on Todo, News and
   Home, which are the screens used most.
8. The frame strips and the critic's craft checklist, then the moments in the
   other workspaces.

## Limits

The critic is good at crowding, alignment, overflow and hierarchy, and weaker
on motion, timing and how a screen feels to use. Part 5 covers the parts of
that a script can measure, and the frame strips in Part 8 let the critic see
motion at all, though a strip of still frames is not the same as feeling a
spring under a finger. The person stays the final check. What this aims
for is screens that need one round of the person's notes, not five.

## What this does not do

It does not change the design laws, replace `check:ui`, or redesign existing
screens on its own. Existing screens improve as steps touch them.

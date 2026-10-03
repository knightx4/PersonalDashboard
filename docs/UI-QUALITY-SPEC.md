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
brief lists the surfaces whose routes the step's files serve. A step that
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
gets three rounds. What happens after a third failure is the decision below.

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
person can remove any entry from `/dev/ui`. An entry that keeps applying
across workspaces can be promoted to a law by the person.

## Part 4: Page patterns

Most layout problems come from a page being arranged from scratch. A small set
of patterns, each a layout component in `components/patterns/` with a gallery
entry and a short rule on `/dev/ui`, gives a step a shape to start from. The
first three are the shapes the gallery shows most:

- **List and detail**: a list you work through, and one item's page, one
  column.
- **Deck**: one item at a time with a fixed forward action and the next item
  loaded, as Quick read and Learn now work.
- **Thread**: a row's comments and Dash's replies.

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

They run in the gate's lint lane beside `check:ui`, on the surfaces the
commit touched, so they add seconds rather than minutes.

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

## Rules

Written in the form [SPEC-LAYER-SPEC.md](SPEC-LAYER-SPEC.md) describes. None
of these checks exists yet, so each rule is marked pending on the plan step
that builds its check. That step takes the mark off, and gives R1 its baseline
measured on main.

**R1.** Every page under `app/` has at least one surface in the gallery.
Checked by: count `routes-without-surface`, target 0, pending #1539.

**R2.** No surface scrolls sideways at 390 pixels.
Checked by: test `tests/interaction/no-sideways-scroll.test.ts`, pending #1537.

**R3.** Every press target is at least 44 by 44 pixels at 390 pixels wide.
Checked by: test `tests/interaction/press-targets.test.ts`, pending #1537.

**R4.** A step that changes a surface has a passing design check before it
closes.
Checked by: test `lib/plan/ui-check-guard.test.ts`, pending #1534.

**R5.** Every preference names the note it came from.
Checked by: test `tests/dev-ui-taste.test.ts`, pending #1529.

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

## Order of work

1. The preferences in `app/dev/ui/taste.ts`, the critic agent, and the change
   to the building reference and the notes skill. These change every screen
   built from then on and need nothing else first.
2. `public.ui_checks`, the shot uploads, and the guard on `plan.ts done`.
3. The four checks on every surface, then the deck and link checks.
4. Before and after on the plan row, the thumbs-down, and the measure.
5. The three patterns, then the rule that steps name one.
6. The notes routine adding preferences.

## Limits

The critic is good at crowding, alignment, overflow and hierarchy, and weaker
on motion, timing and how a screen feels to use. Part 5 covers the parts of
that a script can measure. The person stays the final check. What this aims
for is screens that need one round of the person's notes, not five.

## What this does not do

It does not change the design laws, replace `check:ui`, or redesign existing
screens on its own. Existing screens improve as steps touch them.

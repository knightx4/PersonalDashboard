# One interface

The laws on `/dev/ui` say how a surface is drawn, and
[CORE-AND-DASH-SPEC.md](CORE-AND-DASH-SPEC.md) says how a row is pointed at,
commented on and moved. Neither says what a workspace is made of. So each of
the eight built its own: its own name for the page you land on, its own place
for what is waiting on you, its own way to add a thing, its own words for
closing one, its own back link, its own clock, its own settings page. The app
vision on `/dev/specs` says "one place for everything in my life". The rooms
of that place are each furnished differently, and the person feels it as the
small frictions their notes keep naming: a search that lands on a list instead
of the thing, a back button that forgets where they were, a form where a
button would do, "Not now" here and "Later" there.

This spec names the four rooms every workspace has and the six mechanisms (a
path, an add, a closing word, a clock, a shell, a Dash button) that must be
the same in all of them. It was written from the code and the database on
13 October 2026: three surveys of the tree, the 430 notes the person filed in
the 60 days before, the page views recorded since 2 October, and photographs
of every workspace's first page at 390 pixels.

> **Status:** proposed 13 October 2026 and shaped the same day, at the
> person's ask, into seven features on `/dev/plan`: #1919 (the fixes), #1927
> (one shell mount), #1937 (Now and Inbox), #1931 (the path and the way
> back), #1950 (capture is the add), #1957 (closing words and the clock) and
> #1964 (Dash is one presence). Four questions are decisions under #1937 and
> #1950. The counts under **Rules** were measured for this document; each
> counter is built by the step its rule names, and the baseline is written
> then. Shaped as ordinary features rather than as an overhaul so the
> overnight runner can build them, with the shared piece first in each and
> the counts holding the old way from growing, which is what Part 4 of
> [SPEC-LAYER-SPEC.md](SPEC-LAYER-SPEC.md) is for.

## What there is today

### Eight first pages, eight grammars

| Workspace | First page | What it is | Where "waiting on you" lives |
|---|---|---|---|
| Shopping | Dashboard | A figure page: spend this month, by person, by category, by merchant | Review, with a badge |
| Job search | Today | An inbox: imports to check, interviews, waiting on you, nudges, pipeline counts, since you last looked | Review, which has no nav entry and no badge and is reached from a strip on Today |
| Todo | Agenda | A dated list with an add box that is always open | Waiting, meaning waiting on other people |
| Vault | Notes | A searchable list | Triage, a deck |
| Learn | Now | A deck with a video under each card | None. Now carries a badge instead |
| News | Quick read | A deck | Daily review, which is a reading queue, and Saved |
| Goals | Home | Dash's briefing, an ask box that is always open, area tiles, Do next | Inbox, with a badge |
| Dev | Home | Status chips, Coming back to, Conversations | Inbox, and Home itself, which carries the raises badge |
| The account | Home | The date, every workspace's brief, Today, Done today, Updates, Watching, What Dash did today, This week, Workspaces | The bell, which lists open raises only |

Two workspaces call their first page Home and the account's page is Home, so
the top bar writes the same word over the whole-app page and over Dev's first
page. "Review" means three things: act on the mail sync's guesses (Shopping,
Jobs), read a day's stories (News), and judge findings (`/dev/ui/review`).
The phone dock shows a workspace's first three sections, so the first two
tabs under the thumb are different words in every room.

Photographed at 390 pixels, Home is 7,800 pixels tall with eight sections
stacked, and the Workspaces list sits at the bottom of it. Goals and Todo
each open with an empty text box waiting for words (law 14). Jobs' Today is
an inbox and a dashboard on one page.

The Inbox already exists, built twice. Goals' and Dev's are the same page:
a count card, then Your actions, Questions for you and To review, each row
with its verbs, and a fold of what was put off at the foot. They were
written separately, so one puts things off with Not now into Set aside and
the other with Snooze into Snoozed, one turns a thing down with Not for me
and the other with Dismiss, and no other workspace has the page at all.

### One shell, mounted fifteen ways

`AppShell` is mounted by eight module layouts, four layouts with no module
(`ask`, `open`, `timeline`, `home/week`) and four pages that mount it
themselves (`home`, `account`, `account/spend`, `mail/[id]`). Each copies
about ten loader calls, and they disagree:

| | Settings link | Brief | Sync banner | Paid-cost hints | `error.tsx` | `loading.tsx` |
|---|---|---|---|---|---|---|
| Shopping | yes | yes | yes | yes | yes | list shape |
| Jobs | yes | yes | yes | yes | yes | list shape |
| Todo | yes | yes | no | **no** | yes | own |
| Vault | yes | yes | no | yes | yes | reading shape |
| News | yes | **no** | no | yes | **no** | reading shape |
| Learn | **no** | yes | no | yes | **no** | reading shape |
| Goals | **no** | **no** | no | yes | **no** | reading shape |
| Dev | **no** | **no** | no | yes | **no** | own |
| Mail | n/a | no | no | no | **no** | the root one, outside the shell |

Nothing has a `not-found.tsx`, so the 45 pages that call `notFound()` show
Next's own page, outside the shell. The top bar writes "Workspace › Section"
on every page, and the 14 files that also pass `crumbs` to `PageHeader` show
the path twice. On a phone the top bar carries seven controls: search, Dash,
capture, theme, bell, notes and the account.

### Four detail pages, five kinds of tabs, 32 back links

A page for one row is built one of four ways: `TabbedDetail` (a goal, a
feature, a module, a reading), `DetailPage` and `DetailFacts` from the
list-and-detail pattern (an order, a saved item, a role, a company), a plain
`PageHeader` over a body (an item, an issue, a subject, a file), or by hand
(a vault note, a theme, a Maya thread, a contact, which draws two `h1`s).
Tabs are drawn five ways: `Tabs` through the two tabbed patterns,
`Segmented`, `segmentedFrame` around hand-written links, nine rows of
hand-written `aria-current` links with their own classes, and the filter
rail. Section headings use 54 distinct class strings. There are 189 lists
built from `divide-y` by hand against 11 that use `Table` and 11 that use
the list pattern.

There is no back-link component. About 32 pages draw their own, with
`ArrowLeft` or `ChevronLeft`, at 14 or 16 pixels, at stroke 2 or 1.75, with
or without a 44-pixel press area. Breadcrumbs (plan #1622) appear on about
a dozen pages, in Goals, Dev, Learn and Vault triage, and on no Shopping,
Jobs, News or Todo page.

### Adding a thing

| How | Where |
|---|---|
| A separate page whose only job is a form | Orders, a receipt, inventory (a hub and two scanners), a role, a Learn topic, a quiz |
| An add trigger that opens a compose surface | Goals, Dev, Jobs' interviews and thoughts and material |
| A text box that is always open | Todo's agenda, a Learn track's reading line, Goals' ask box |
| A query parameter that opens a compose at the top of the list | Vault notes |
| Capture, from the header or ⌥C | A todo, a goal update, a note on a job, a vault note |
| The notes button in the header | A bug or request for Dev |

Capture cannot add an order, a role, a reading, a saved item or a goal. After
a form page saves, the app goes to the new row with no toast; after capture,
a chip flies to the workspace and a toast offers Undo; after Todo's box, a
line of text.

### Closing a thing

The schemas close a row with twelve words: `dropped` (todo, goals,
check-backs), `parked` (goals), `declined` (notes, Dash's actions),
`dismissed` (saved items, suggestions, takeaways, essay notes, Learn cards),
`abandoned` (readings, Learn goals), `shelved` (tracks), `withdrawn`
(applications), `expired` (suggestions), `detached` (essay notes),
`not_now` and `never` (track offers), `skipped` (quizzes). On screen the
buttons say Done, Drop, Dismiss, Not now, Later, Never, Archive, Decline,
Pass, Fewer, Remove and Delete. Putting a thing off has three vocabularies:
Todo's Later and Bring back, Goals' Not now with Tomorrow, This weekend,
Next week and Next month, and the inbox snooze with Tomorrow and Next week.

### Telling the time

116 files format a date or a time, through four APIs: `Intl.DateTimeFormat`
in 106 places, `toLocaleDateString` in 33, `toLocaleString` in 36 and
`toLocaleTimeString` in one. `lib/clock.ts` holds the one shared formatter,
for the clock face. The preference "times are 12-hour with AM and PM,
everywhere" (`taste.ts`) is kept by 116 files agreeing, which is the same
arrangement that let 24-hour times reach the calendar in September.

### Talking to Dash

Eleven surfaces open a conversation with Dash, drawn by two chat components
(`Thread` on a row, `TalkThread` in the Ask sheet, News' Discuss, Maya and
Learn's cards). The buttons that start a run say Ask Dash, Send to Dash,
Hand it to Dash, Prepare me, Search with AI, Summarize, Find something to
read and Shape into a plan. The components that show a run's progress
(`components/runs/`) are used in Goals and Dev and nowhere else. "AI" appears
on one button and "Jev" on one row.

Where the person talks: 231 turns on plan items, 77 on ideas, 75 on raises,
52 on job roles, 26 on goal steps, and under five on any other kind of row.
Where Dash writes: of 1,126 recorded Dash actions in the last 30 days, 1,106
came from routines and scheduled runs, 9 from threads, 6 from Ask and 5 from
capture. Nearly everything Dash does, the person sees only in Home's "What
Dash did today".

### Where the person is

Since 2 October the proxy has recorded page views. In those 12 days: Home 90
opens, Dev 90, Jobs 22, Goals 16, Learn 10, News 6, Shopping 5, Vault 4,
Todo 1. Of the 430 notes filed in 60 days, 334 came from a laptop and 96
from a phone. `core.page_views` records no device, so whether the person
mostly uses the app on a phone, which [UI-QUALITY-SPEC.md](UI-QUALITY-SPEC.md)
assumes, is not known.

The second most opened route is `/onboarding`, with 88 opens against Home's
90. The proxy sends every signed-in visit to `/` there, and the page sends a
finished account on to `/home`. Opening the app from its icon is two
requests, two server renders and two page-view rows before anything is
drawn, and it has been since the redirect was written.

### The small things

- The shell scrolls its pane to the top on every change of path, including
  the back button. From a laptop, back from a role lands at the top of the
  pipeline, against the wayfinding rule that back is a first-class control.
- `rounded-pill` is used 37 times and no token or utility defines it; the
  built stylesheet has no rule for it. Those chips and badges have square
  corners in every theme. About 141 other radius classes are off the three
  tokens, plus 58 bare `rounded`, so Aurora's rounder and Poster's square
  corners apply to cards and skip menus and chips.
- Lucide icons are drawn at stroke 1.75 in 237 places and stroke 2 in 184,
  against "one weight, no exceptions".
- Fourteen real controls hard-code `h-7`, `h-8` or `h-12`, which the density
  dial does not reach and `check:ui` does not catch (it matches `h-9` to
  `h-11`).
- The account page has no title and no `h1`, and at 390 pixels its fifth
  tab runs off the right edge. Its list of module settings omits News. The theme picker, an account setting, sits in the top bar of
  every page.
- `/dev/raised` sets its document title to "Dash" while its heading says
  Home. The public front door's title is "Your Gmail".
- The front door keeps its own copy of the Aurora palette in a CSS module,
  14 hex and 38 `rgb()` values that drift when the theme changes.
- Route error copy differs: Shopping and Jobs say "this page", the rest name
  the thing.
- Two comments in the shell are no longer true: that only Review and Raised
  carry badges (Goals' Inbox and Learn's Now do too), and that the vault is
  read-only (three components write to it).

## Part 1: Four rooms in every workspace

Every workspace has the same four rooms, in the same order in its column and
its dock, with the same names.

**Now.** The first section, and where the switcher lands. What is going on in
this workspace, read in a minute: Dash's one-line brief (the one the top bar
shows), then the one thing to do next, then folds for the rest, each fold
carrying its count (law 10). Pattern: main plus rail. Shopping's figures,
Jobs' This week and Since you last looked, Goals' briefing and areas, Dev's
status chips and Coming back to all fit this shape; the decks (Learn, News)
are their own Now, since the next card is the one thing to do.

**Inbox.** The second section. Everything in this workspace whose move is on
you (`lib/core/move.ts`), newest first, with its verbs on the row. It is not
a second list: it is the one on-you list of
[CORE-AND-DASH-SPEC.md](CORE-AND-DASH-SPEC.md) Part 4 filtered to the
workspace, so a row added to that list appears in its workspace's Inbox the
same day. The mail sync's guesses (Shopping's and Jobs' Review) are Inbox
rows that open the review queue. The page is the one Goals and Dev already
draw, made one component with the groups Your actions, Questions for you and
To review, and used by every workspace. Jobs' nudges are Inbox rows only while a
setting asks for them, which answers the note of 18 September asking for
them to go. The Inbox carries the workspace's one badge, and nothing else in
the column does. Learn's badge on Now and Dev's on Home move here. Todo's
Inbox is the undated on-you pile of core Part 4; its Waiting section stays,
as the account's one list of what waits on someone else, which it already
is (a role waiting on a company and a refund waiting on a shop sit on it
today). The vault's triage deck keeps its name for the folder it empties,
the Inbox note, and sits in the vault's Inbox as the row "3 quick notes to
file".

**The lists.** The workspace's own tables, each as list and detail, after
the Inbox in whatever order the workspace needs.

**Settings.** At the foot of the column, in every workspace. Learn, Goals and
Dev have settings today that live elsewhere (the morning run and its hour on
`/goals/runs`, the overnight runner's card on Dev's Home, Learn's track
offers); they move to a settings page named like the others. A settings page
is one shape: `TabbedSections` when it has more than three sections, a
column of `CardSection`s otherwise, autosave on blur with a quiet toast (the
save model on `/dev/ui`). The six pages built six ways move onto it.

**Home.** The account's Now and Inbox. Its Now is the date, the day brief,
and each workspace's brief line with its mark, each a link to that
workspace's Now. Its Inbox is the union of the workspaces' Inboxes, grouped
by workspace, and is what the bell opens, which finishes the wiring that
[DESIGN-UPDATE-PLAN.md](DESIGN-UPDATE-PLAN.md) left open under 3.3. Today,
Done today, Updates, Watching, What Dash did today and This week are folds
under the Now, open from laptop width in the rail and closed on a phone with
their counts on the line. On a phone the first screen is the greeting, the
date, the briefs and the Inbox count.

**The dock.** Now, Inbox, the switcher, the third section, More. The same
five positions in every room, so the thumb learns one layout.

Section addresses stay what they are (`/shopping/dashboard`, `/jobs`,
`/goals`); only the names in the column and the dock change. `/jobs/review`
and `/shopping/review` gain the Inbox name and keep their paths.

## Part 2: Every thing has a page, a path and a way back

**A page.** Every ref opens a page (`/open/[ref]`, core Part 1). A search hit
opens the thing, never the list that holds it; the note of 5 October ("when
I search for a specific goal then click on it it doesn't go directly to the
goal") is the rule stated as its failure.

**A path.** `refPath(ref)` in `lib/core/refs.ts` returns the chain from the
workspace down to the row: workspace › section › parent › thing, from the
catalogue, where each table's entry declares its section and, where it has
one, its parent ref. `PageHeader` draws it on every page for one row. The
top bar then names only the workspace; the "Workspace › Section" it writes
today is the first two parts of the same path, drawn a second time. A list
page draws the path's first two parts, which is what the top bar did.

**A way back.** One `BackLink`, drawn by `PageHeader` under the path on a
phone and beside it from laptop width, pointing at the path's parent, or at
the list the person came from with its filters intact when the URL carries
`from` (the wayfinding rule). The 32 hand-written links go. Back restores
the pane: the shell scrolls to the top on a forward navigation only, and
keeps each path's scroll offset for the back and forward buttons.

**A preview.** Hovering a ref link, or holding it on a phone, shows the
row's title line and its move, from `refTitles` (the note of 17 September).
Comment bodies, Dash's replies, goal descriptions and plan details all
render refs as these links, so "#1490.11" is never bare.

**Decks.** Every deck has Previous as well as Next. News has it; Learn's Now
and the vault's triage get it.

## Part 3: One way to add anything

Capture is the add. Each workspace declares the kinds it can take in
capture's registry (`lib/capture/actions`): today a todo, a goal update, a
job note and a vault note; added, an order from a receipt or a sentence, an
inventory item, a role from a posting URL or a sentence, a reading, a saved
item, a goal, an area, a quiz, a plan item, an idea, and a bug or request
for Dev. Each kind says what it needs to make the row (a title, at most one
more thing) and what it fills in afterwards on the thing's page.

Every Add button on a list opens capture aimed at that kind, with the sort
step skipped. The press makes the row and opens its page (the preference
"adding something is one press, with details after"), and the chip flies to
the section as it does from the header. Untargeted text from the header or
⌥C still goes through Dash's sort. The notes button in the header becomes
capture aimed at Dev, and the always-open boxes on Todo's agenda, a Learn
track and Goals' Home become buttons (law 14). The nine routes whose only
job is a form go, except the two barcode scanners, which become capture's
camera step for an inventory item and are reached from it.

What capture made says so on the row, with Undo, through `core.dash_actions`
when Dash sorted it and through the same toast when the person aimed it.

## Part 4: Four words for closing

A row leaves the open state by one of four words, and the buttons say them.

| Word | Meaning | Storage words it covers |
|---|---|---|
| Done | It happened. | `done`, `read`, `reached`, `purchased`, `covered` |
| Dropped | It will not happen, and that is a decision. | `dropped`, `abandoned`, `shelved`, `withdrawn`, `never`, `dismissed` on a person's own row |
| Later | Not now; bring it back on a day. | `parked`, `not_now`, snoozed, set aside, Todo's Later |
| Declined | A proposal the person turned down. | `declined`, `dismissed` on a suggestion, takeaway, proposed goal or Dash action, `expired` |

Declined is only for things the app or Dash proposed; the person's own thing
is dropped, never declined. Delete stays Delete, in the danger tone, behind
`ConfirmStep`, and is never one of the four. Later has one menu everywhere:
Tomorrow, This weekend, Next week, Next month, Pick a day, built from
`lib/core/snooze-days.ts` and replacing Goals' set-aside and Todo's Later.
Each word has one glyph from `status-glyph.tsx`, and each closes through the
toast with Undo.

The schemas keep their words; they are right about their own rows.
`lib/core/lifecycle.ts` maps each workspace's statuses onto the four, as
`move.ts` maps them onto the five moves, and `tests/lifecycle-words.test.ts`
fails a status with no mapping.

## Part 5: One clock

`lib/core/when.ts` is the one place a date or time becomes words, and it
knows the account's timezone. Four functions:

- `whenDay`: Today, Tomorrow, Yesterday; a weekday name within six days;
  "12 Oct" beyond that; the year only when it is not this year.
- `whenTime`: 12-hour with AM and PM, no seconds, no leading zero.
- `whenSpan`: "2 h 10 min", "3 days", "in 1d 1h" for a deadline, in the
  mono face and tabular figures (UI quality Part 12).
- `whenAgo`: "3 min ago", "yesterday", and after six days a day, used only
  inside threads, the status line and Updates, where the moment matters more
  than the date.

A time never shows beside a day the person did not give a time for (law 3).
`lib/clock.ts` folds in. The 116 files move onto it one workspace at a
time, and the count holds the rest from growing.

## Part 6: One shell, mounted once

`shellFor(module)` in `lib/shell/` loads what every layout loads today and
returns the shell with its props; each layout becomes its sections and one
call. Every workspace then has a brief, a settings link, the sync banner
where it has a sync, paid-cost hints, an `error.tsx` that names the
workspace, a `not-found.tsx` inside the shell saying the thing is no longer
there (the `NoLongerThere` page `/open` already draws), and a `loading.tsx`
in its pattern's shape.

The top bar on a phone holds four controls: search, capture, Dash and the
account. The theme picker moves to the account page, where the setting
lives (⌘K still switches it from a keyboard). The bell is Home's Inbox tab
and the dock. The notes button is a capture kind. The proxy sends a
signed-in visit to `/` straight to `/home`, and to `/onboarding` only when
`onboardingNeeded` says so, which is the check the onboarding page makes
today one hop later.

## Part 7: Dash is one presence

**One name.** Every control that calls a model says Dash and nothing else:
not "AI", not a model's name. A button that starts a run is a verb with
Dash's mark before it and the cost hint beside it (law 16): "Prepare for
this interview", "Summarize this reading", "Shape this into a plan". "Ask
Dash" is the one verb for talking. Maya is a voice Dash takes in the vault
(core decision 2) and keeps its name and owl there; Jev is a model and is
named where the cost hint names models (the note of 8 October) and nowhere
else.

**One working state.** When Dash is on a row, the row's move reads "Dash is
on it" with the alive mark, the button that started the run shows the same
mark pulsing in place of its label, and the status line says what Dash is
doing (the note of 5 October asking for the pulse "really everywhere").
`components/runs/` is how every workspace shows a run, not Goals and Dev
alone, and a run's page lists the refs it touched as links.

**One thread.** `Thread` absorbs `TalkThread`, so the Ask sheet, Discuss,
Maya and Learn's cards are the one component with a subject or none. A
thread posts the person's turn the instant they send it. The person's words,
Dash's words and quoted text are three looks defined once, as the
preference "text never sits bare on the background" asks, and used by every
thread, the goals briefing and Dash's replies in capture.

**One record.** What Dash did today stays on Home. Each workspace's Now
carries the same fold filtered to it, in place of Goals' "Dash is on 3
things" and Dev's "Conversations", each written its own way today.

## Part 8: Know where the person is

`core.page_views` gains `device` (phone or laptop, read from the user agent
at the proxy) and `from` (the route the person came from). Until it has
them, the phone-first assumption is a guess the notes do not support, and
the order below follows the page views as they are.

## Order of work

1. The fixes: the launch hop, the pane scroll on back, `rounded-pill`, the
   `not-found.tsx` files, the account page's title and its settings list,
   `/dev/raised`'s title, the front door's title, the two stale comments,
   and the `device` column. Each is a note's worth and goes through the
   notes routine, before any step of the overhaul.
2. Part 6, one shell mount. Every later part touches every layout once, so
   this first, and it makes the gate's list and error files uniform in one
   change.
3. Part 1, the four rooms. Names, nav order, the dock, Home's Inbox as the
   bell. Home and Dev first, then Jobs and Goals, which is the order the page
   views give.
4. Part 2, the path and the way back, with `refPath` in the catalogue and the
   back-link sweep.
5. Parts 4 and 5, the closing words and the clock. Each is a shared module
   and a codemod per workspace, held by a count.
6. Part 3, capture as the add, one kind at a time, the form pages removed
   as their kind arrives.
7. Part 7, Dash's presence: the names, then the working state, then the
   thread merge.

Each phase ends with one test in `tests/flows/` across the parts, as the
spec layer asks: open the app from its icon and land on Home in one request;
search a goal, open it, press back and land on the list at the same scroll;
add a role from the pipeline in one press and find it in the Inbox.

## Rules

Written in the form [SPEC-LAYER-SPEC.md](SPEC-LAYER-SPEC.md) describes.
Baselines were measured on main on 13 October 2026 for this document; each
counter is written by the plan step its rule names, which records the
baseline it measures and takes the pending mark off.

**R1.** Every workspace's first two sections are named Now and Inbox, in
that order, and its settings link is set.
Checked by: test `tests/workspace-rooms.test.ts`, pending #1943.

**R2.** Only an Inbox carries a badge.
Checked by: test `tests/workspace-rooms.test.ts`, pending #1943.

**R3.** A page for one row draws its path from `refPath`.
Checked by: count `row-pages-without-path`, baseline 43, target 0, pending #1932.

**R4.** There is one back-link component.
Checked by: count `hand-rolled-back-links`, baseline 32, target 0, pending #1934.

**R5.** Back from a row lands on the list at the same scroll offset.
Checked by: test `tests/flows/search-open-back.test.ts`, pending #1934.

**R6.** A date or time becomes words only in `lib/core/when.ts`.
Checked by: count `date-formatting-files`, baseline 116, target 1, pending #1961.

**R7.** A row is closed with one of Done, Dropped, Later or Declined, and
every workspace status maps onto one.
Checked by: test `tests/lifecycle-words.test.ts`, pending #1958.

**R8.** No section links to a page whose only job is a form.
Checked by: count `form-only-pages`, baseline 9, target 0, pending #1953.

**R9.** The shell is mounted in one place.
Checked by: count `shell-mounts`, baseline 15, target 1, pending #1928.

**R10.** Every route group has `error.tsx`, `not-found.tsx` and
`loading.tsx`.
Checked by: test `tests/route-states.test.ts`, pending #1923.

**R11.** Opening `/` while signed in is one redirect, to Home.
Checked by: test `tests/proxy-launch.test.ts`.

**R12.** A control that calls a model names Dash, and "AI" appears on no
control.
Checked by: count `ai-on-controls`, baseline 1, target 0, pending #1965.

**R13.** There is one thread component.
Checked by: count `thread-components`, baseline 2, target 1, pending #1967.

**R14.** A radius class is one of the four tokens (`rounded-pane`, `rounded-card`, `rounded-control`, `rounded-pill`), `rounded-full` or `rounded-none`.
Checked by: count `off-token-radius`, baseline 199, target 0.

**R15.** Lucide icons are drawn at one stroke weight.
Checked by: count `icon-stroke-off`, baseline 184, target 0, pending #1926.

**R16.** The phone top bar holds at most four controls.
Checked by: audit.

**R17.** Every page view records the device it came from.
Checked by: test `tests/proxy-device.test.ts`.

## Decisions

**1. What are the two rooms called?**

- A. Now and Inbox. Now is already Learn's word and reads as "what is going
  on"; Inbox is Goals' and Dev's word and reads as "what is on me".
- B. Today and Inbox. Today is Jobs' word and the agenda's, and says when
  rather than what.
- C. Home and On you. Home is three things already.

Recommendation: A.

**2. Does the bell go?**

- A. Home's Inbox is the bell. The icon leaves the top bar; the dock's Inbox
  tab on Home and the Inbox count on the first screen carry it.
- B. Keep both, the bell showing the union and the Inbox tab the same.

Recommendation: A. Two controls that open the same list teach the person to
ignore one.

**3. Does the theme picker leave the top bar?**

- A. Yes. It is an account setting, it is on the account page, and ⌘K picks
  a theme from a keyboard.
- B. No. The person changes themes often enough to want it one press away.

Recommendation: A, since the phone bar cannot hold seven things and this is
the one that is not about the page.

**4. Jobs' Today is a Now and an Inbox on one page. Which is it?**

- A. Split it. Now keeps This week, Live applications and Since you last
  looked. Inbox takes imports to check, Waiting on you and the reminders,
  and Review becomes rows in it.
- B. Keep Today whole as the Now and leave Review as the Inbox.

Recommendation: A. The person opens Jobs more than any workspace but Dev,
and the imports-to-check card is the thing they act on; it belongs with the
other things they act on.

**5. Does capture replace the form pages, or sit beside them?**

- A. Replace. Every add is one press from the list, with details on the
  thing's page. The scanners become capture's camera step.
- B. Beside. Capture gains the kinds, the form pages stay for a full entry.

Recommendation: A. The page views show no form page opened in 12 days, and
the preference "no form where a button would do" is the person's.

**6. On a phone, what is Home's first screen?**

- A. The greeting and date, the workspace briefs, the Inbox count. Today
  is the first fold.
- B. The greeting and date, then Today. The briefs fold.

Recommendation: A. The briefs are the Now; Today is the agenda and has its
own tab.

## Costs and risks

- Renaming sections changes the ⌥ digits and the thumb's habits for a week.
  Paths do not change, so links in notes and threads keep working.
- Moving dates onto `when.ts` touches 116 files. Done per workspace with the
  count holding, each move is a small diff, and the twelve-hour preference
  is kept in one place instead of 116.
- Capture as the add depends on aimed capture skipping the sort, so the
  press is instant. A kind that needs a model call to make its row (a role
  from a posting URL) shows the loading state at once and makes the row when
  it lands.
- Merging `TalkThread` into `Thread` touches the Ask sheet, which the person
  uses daily. It goes last, after the names and the working state, and
  behind the gallery and the critic like any screen change.
- The spec-layer counts stop the old way from growing while each workspace
  moves, so the parts can ship over weeks without the app getting more
  mixed than it is.

## What this does not do

It does not change a law or add one. It does not redesign the content of
any list or detail page; that stays with the patterns and the critic. It
does not merge workspaces, change a path, or touch a schema's status words.
It does not decide Learn's tabs, which [CUT-BACK-SPEC.md](CUT-BACK-SPEC.md)
holds. It does not say what Dash can do, which
[CORE-AND-DASH-SPEC.md](CORE-AND-DASH-SPEC.md) holds; it says how Dash
looks and is named wherever it appears.

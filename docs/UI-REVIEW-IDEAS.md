# Ideas from the UI review against Linear

Fifteen ideas, from a review of `/dev/ui` against Linear's product pages and a
few other tools known for their interaction design. Each `## ` heading below is
one idea, filed with:

```
npx tsx scripts/plan.ts idea --file docs/UI-REVIEW-IDEAS.md
```

The file stays in the repo as the record of where the ideas came from. The
rule each one proposes is also on `/dev/ui`; the idea is the work of making the
app obey it.

## A keyboard model, not a bag of shortcuts

Linear's identity is j/k, x, Enter, Esc, c and g-then-letter, consistent across every list. The model is on /dev/ui under "The keyboard model"; the app today has arrow handling in a handful of components and j/k only in the jobs review queue. Rule: any list meant to be worked can be moved through, opened, selected, acted on and escaped without a mouse. Build one list-keyboard hook and put it under every worked list: the review queues, the agenda, orders, roles.

## Actions in the palette, not only places

Linear's ⌘K is contextual: with an issue focused it offers change status, assign, set priority. Raycast is the same idea. Our palette navigates, searches and picks a theme. Rule: every action available on a focused row is reachable from ⌘K. Needs the keyboard model's notion of a focused row, then a way for a page to register its row actions with the palette.

## Selection and bulk

Linear's floating action bar after multi-select is what makes triage fast. /dev/ui specifies it under "Bulk": selection on hover of the row's left edge, shift-click ranges, ⌘-click toggles, x on the focused row, the page header becoming an action bar, Esc clearing, one undo per batch. Two components do selection their own way today (inventory, the roles list) and there is no primitive. Build the primitive and put it under the review queues first.

## Status as a glyph

Linear's status circles and priority bars encode state in shape, so colour stays free and colour-blind readers lose nothing. Law 4 says "ink and a shape" but gives no shapes. Define the glyph set for the seven pipeline stages and the todo states — an outline, a part-filled circle, a filled one, a struck one — render it on /dev/ui beside the pipeline hues, and use it wherever a stage is shown as a bare coloured chip today.

## Display options per view

Group by, order by, show and hide properties, and saved views are Linear's superpower for lists. /dev/ui says sort, filter, group and search are four different questions and a list of any size needs all four from the URL, with subtotals on group headers. Inventory has all four; nothing else does. Add group-by and a properties toggle to the shared list shape so every list page answers all four, then saved views as named URLs.

## Page anatomies

Linear has a fixed detail layout: title and description left, properties column right, activity below, peek with Space. /dev/ui shows the anatomy of a row and nothing above it. Draw the anatomies for the list page, the detail page, the dashboard, settings and compose, at phone and laptop width, as real components on /dev/ui, and bring the role page and the order page onto the detail anatomy.

## Latency tiers

Linear's sync engine makes everything feel instant. /dev/ui now carries the three tiers — instant, optimistic with a loud failure path, pending with a labelled control — under "Latency". useOptimistic appears in one file. Assign every write in the app a tier, and move the optimistic ones (check a task, move a card, pin, snooze, toggle a preference) onto useOptimistic with the revert-and-say-why half written in the same commit.

## Progress, health and charts

Linear's plan pages are mostly progress bars, cycle graphs and health states. This app is a dashboard, has Figure, Sparkline and the return fuse, and /dev/ui has no data-display section. Rule: a figure, a delta with its period named, a sparkline with its window, a fuse with its real denominator, and law 3 applied to "too young to mean anything". Add the section to /dev/ui with the real components, and a health vocabulary (on track, at risk, closing) for anything with a deadline.

## Elevation and layering

Surface, raised, sunken, popover scrim and the z ladder exist in globals.css with careful comments and are now on /dev/ui under "Elevation and layering". What remains is the sweep: every hand-written z-index and shadow in the app onto one of the ladder's rungs, and a test that no z value outside the ladder appears in a class string.

## The attention ladder and the inbox

Linear's Inbox is a keyboard-driven triage surface. The five-rung ladder — status line, nav count, bell, banner, dialog — is on /dev/ui under "The attention ladder". The bell is still unwired: derive its entries from the return windows, interview prep, vault token and review queue that already exist, make the panel a list that can be worked with the keyboard model, and move the sync and vault banners down to the rung they have earned.

## The machine as a participant

Linear's AI page's core idea is that agents are members: their work appears in the same threads, attributed and reviewable. The status line already speaks in machine voice, and this app ingests mail and syncs in the background. Rule: work the system did is shown where your work is shown, attributed, and undoable where possible. An order the mail parser created says so on the order; a task the sync completed says so on the task; both offer undo.

## Voice

Linear's microcopy is sentence case, terse, never celebratory. The rules are on /dev/ui under "Voice": sentence case, no "successfully", say what happened and what changed, buttons are verbs. Sweep every string in the app against them — toasts, empty states, banners, buttons, the onboarding — and add a lint for the words that never appear ("Successfully", "Oops", an exclamation mark, an emoji).

## Accessibility and touch

3:1 on control borders, 4.5:1 on text, 44px targets, focus visible, popovers trap and return focus, nothing depends on hover or drag. All on /dev/ui now under "Accessibility contract" and "Touch". The pipeline board's drag has no keyboard or touch path; audit every drag and every hover-only action against the contract and fix what fails, then add an axe pass to the preview gallery.

## Loading and error

Skeletons never spinners, every route has loading.tsx and error.tsx, a failed source says so in place. Law 2 covers the last; the first two are on /dev/ui under "States". Audit every route group for both files, make each loading file render that page's real shape rather than a generic list, and wrap slow independent regions in Suspense so a slow chart does not hold the page.

## First run

Linear onboards with a sample workspace and a cheatsheet. /dev/ui says onboarding asks for exactly one thing, skip is never punished, and the empty-to-full transition is a designed moment. Walk a new account through every workspace and fix each first screen against those rules; consider a sample-data mode so a new person sees the app full before it is.

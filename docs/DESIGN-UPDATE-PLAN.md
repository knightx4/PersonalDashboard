# Design update plan

The design language is [`docs/design-language.html`](design-language.html) — open it in a
browser, and use the five theme swatches top right. This file is the migration: how the
existing app gets there, in an order where every step ships on its own.

Read the language first. This document assumes it.

## The shape of the work

The app has **better design thinking than design infrastructure**. The reasoning is
excellent and almost all of it lives in JSDoc comments, which makes it invisible to the
next person — so every new page re-derives it and drifts a little. Four near-identical
top bars, two page headers, two left rails, a `Card` primitive used twelve times against
a hand-written card utility used over a hundred times.

On top of that, three things are simply missing: **a second colour mode**, **any loading
or error state at all**, and **a reason to feel like it belongs to one person** rather
than to a generic SaaS template.

So the work is three strands, done in this order:

1. **Correct** — contrast, tokens, type scale. Small diffs, large effect, unblocks the rest.
2. **Consolidate** — one of each primitive. Removes the drift permanently.
3. **Extend** — dual mode, themes, texture, per-workspace colour, and the handful of
   ideas a large product would not ship.

Extending before consolidating would mean building five themes on top of a hundred
hand-written colour strings. That is the one ordering constraint that actually matters.

### Rules for every phase

- **Every phase ships.** No branch lives longer than its phase. There is no "design
  refactor" branch that runs for three weeks.
- **Touch it, fix it.** Any file you open for another reason gets brought onto the
  language before you close it. This is how the long tail actually gets done.
- **The language file changes in the same commit as the code.** A guide that lags the
  code is worse than none, because people follow it.
- **No visual change without a contrast check.** Every phase that touches colour runs the
  checker from Phase 0.

---

## Phase 0 — Foundations

Nothing here is visible as a feature. Everything after it depends on it.

### 0.1 Restructure the tokens for two modes

`app/globals.css` currently declares one palette under `@theme` with
`color-scheme: light` hard-coded. Split it: `@theme` declares the *names*, and each theme
declares the *values* under a `[data-theme]` selector, with the system preference as the
fallback for an unset choice.

Add the tokens the language needs and the current file lacks: `--color-raised`,
`--color-sunken`, the four workspace accents and their tints, `--color-caution*`, the
`-soft` decorative variants, and the texture triple (`--texture`,
`--grain-opacity`, `--grain-blend`).

- **Files:** `app/globals.css`, `app/layout.tsx` (theme attribute + no-flash script).
- **Done when:** setting `data-theme="ink"` by hand in devtools turns the whole app dark
  with no hard-coded colour surviving, and there is no white flash on first paint.
- **Risk:** low. Purely additive until something consumes it.

### 0.2 Fix contrast

Measured against white, the current palette fails in six places that matter. These are
not close calls.

| Token | Now | Ratio | Becomes | Ratio |
|---|---|---|---|---|
| `ink-muted` | `#6b6b66` | 5.36 | *unchanged* | ✓ |
| `ink-faint` | `#9a9a94` | **2.83** | `#80807a` — **and redefined as decoration only** | 3.97 |
| `brand` | `#6a82fb` | **3.39** | `#4a5fd0` | 5.47 |
| `brand` on `brand-tint` (the active nav tab) | — | **3.01** | — | 4.86 |
| white on `brand` (primary button) | — | **3.39** | — | 5.47 |
| white on `accent-orange` (count badge) | — | **2.34** | **dark ink on the fill** | 7.46 |
| `positive` | `#3fa37a` | **3.12** | `#2e7d5b` | 5.00 |
| `status-process` on its tint | `#d97706` | **3.07** | `#b45309` | 4.84 |
| `status-offer` on its tint | `#059669` | **3.58** | `#047857` | 5.21 |
| `status-lead` on its tint | `#78716c` | 4.40 | `#6f6864` | 5.01 |
| `status-ghosted` on its tint | `#a8a29e` | **2.41** | `#78716c`, **rendered as an outline** | 4.59 |

The old values are not deleted — `#6a82fb` becomes `--color-brand-soft` and `#3fa37a`
becomes `--color-positive-soft`, for gradients, chart fills and illustration. The app
keeps its character; only text-bearing colour moves.

**`ink-faint` is the interesting one.** Meeting 4.5:1 would put it within a hair of
`ink-muted`, which makes the distinction pointless. So instead it is *redefined*: faint is
decoration — placeholders, disabled controls, redundant glyphs, hairline dividers — and
everything currently faint that carries information (counts, timestamps, table headers,
hints) moves to `ink-muted`. That is a codemod plus a review pass, and it fixes ~130
sub-threshold instances.

**Ghosted gets an outline instead of a fill.** Drained should mean less ink on the page,
not less legibility. A grey nobody can read is broken, not quiet.

- **Files:** `app/globals.css`, `components/jobs/ui/status-badge.tsx`,
  `components/shell/notifications-button.tsx`, `components/shell/top-nav.tsx` and the
  other three navs, plus the `ink-faint` sweep.
- **Done when:** the checker (0.4) passes on every theme.
- **Risk:** medium — it is a visible change to the app's blue. Worth doing in one commit
  so it reads as a decision rather than a drift.

### 0.3 Name the type scale

Eight named steps in `@theme`; ban `text-[Npx]` with a lint rule. The specific ambiguity
being removed: `text-sm` (14px) and `text-[13px]` are currently used interchangeably for
the same role in different files. **13px is chrome, 14px is content**, and the scale makes
that unambiguous.

Current usage, for scale: 381 × `text-[13px]`, 249 × `text-[12px]`, 190 × `text-sm`,
130 × `text-[11px]`, plus strays at 10, 14, 15px and four Tailwind names.

- **Files:** `app/globals.css`, `eslint.config.mjs`, then a mechanical sweep.
- **Risk:** low, but the diff is wide. Do it as its own commit so review is a skim.

### 0.4 The contrast checker

A script that walks every declared token pair in every theme and fails on anything below
its threshold. Wire it into CI.

Five themes is five times the surface area for a contrast bug to hide in, and *"it looked
fine on my screen"* is exactly how all of them get shipped. This script is what makes
Phase 2 safe to attempt at all.

- **Files:** `scripts/check-contrast.ts`, `.github/workflows/`.
- **Done when:** it fails on the current palette and passes after 0.2.

---

## Phase 1 — One of each primitive

The single largest source of drift. Every item here deletes more code than it adds.

### 1.1 Make `Card` usable, then use it

`components/ui/card.tsx` exists and nobody reaches for it, because its padding is fixed at
`px-5 pt-5 pb-3` and it insists on a header. Add a `padding` variant
(`standard | dense | none`) and make headerless first-class. Then migrate.

Worst offenders: `app/jobs/(app)/roles/[id]/panels.tsx` (15 hand-written cards),
`app/jobs/(app)/settings/view.tsx` (6), `app/jobs/(app)/companies/[slug]/panels.tsx` (5).

- **Done when:** `rg 'rounded-card border border-border bg-surface'` returns only
  `card.tsx`, `banner.tsx` and `empty-state.tsx`.

### 1.2 A `Banner` component

Four tones — `info`, `warn`, `bad`, `good` — replacing three unrelated implementations,
one of which (`components/shell/inbox-sync-banner.tsx`) is raw `emerald-50` /
`emerald-200` / `emerald-950` with no token in sight.

Also replaces the bespoke coloured paragraph in `app/account/view.tsx` and the ad-hoc
warning in `app/todo/page.tsx`.

- **Done when:** no raw Tailwind palette colour survives anywhere in `app/` or
  `components/` (19 instances today: `bg-red-50`, `bg-amber-50`, `bg-emerald-50`,
  `text-amber-700`, `bg-emerald-500`, `bg-red-500`, `bg-green-50`).

### 1.3 One `WorkspaceNav`

Replaces `components/shell/top-nav.tsx`, `components/jobs/shell/top-nav.tsx`,
`components/todo/shell/top-nav.tsx` and `components/vault/shell/top-nav.tsx` with one
config-driven component. Section lists move into `lib/modules.ts` alongside everything
else about a module.

The divergence this removes is not intentional, whatever the comments say: Todo has no
notifications button, Vault has no settings gear, and Jobs' section links are 13px where
everyone else's are 14px. Nobody decided any of that.

Sets `data-workspace` on the shell, which is what makes Phase 2.2 a one-line change.

### 1.4 One `PageHeader`, one `LeftRail`

Two `PageHeader` definitions differing only in `string` vs `ReactNode` props — keep the
`ReactNode` one. Two `LeftRail`s differing in width (`w-56` vs `w-52`) and, more
importantly, in **opposite mobile defaults** (open vs closed). Keep closed.

### 1.5 A `Field` component

Label + control + hint + error in one place. Hints are currently hand-rolled as
`text-[11px] text-ink-faint` in dozens of files — both off-scale and under contrast, so
this one lands two fixes at once.

---

## Phase 2 — Two modes, five themes, and a texture

The visible half of the work. Only safe once Phase 1 has removed the hand-written colour.

### 2.1 Ship Paper and Ink

The two defaults. Follow `prefers-color-scheme` until the user chooses; once they choose,
it sticks. Store on `core.account_settings` so it follows the account, and mirror to a
cookie so the server renders the right theme on first paint.

**A theme that flashes white before going dark is worse than no dark mode.** The cookie is
not optional.

- **Files:** migration for `account_settings.theme`, `app/layout.tsx`, `app/account/view.tsx`.

### 2.2 Per-workspace accent

Shopping is ember, Jobs is plum, Todo is moss, Vault is ochre. The shell sets
`--accent` from `data-workspace`; every component references `--accent` and never a
workspace token directly.

This is the most visible personal touch in the whole plan and it costs almost nothing once
1.3 has landed. **Chrome takes the accent; content keeps its own meaning** — a pipeline
card is still submitted-blue inside the plum workspace, because that colour is a claim
about the pursuit, not about where you are standing.

### 2.3 The grain

One fixed `body::before` with an inline SVG `feTurbulence`, 3–5% opacity, blend mode per
theme, `pointer-events: none`. No image request, no layout, no repaint.

`pointer-events: none` is not optional — a full-viewport overlay that swallows clicks is a
catastrophic and very confusing bug.

### 2.4 Riso, Terminal, Dusk

The three optional themes, plus the picker with live hover preview. This is where the
"customize your own space" idea actually lands, and it is cheap: each is roughly twenty
variables, and 0.4 proves each one is legible.

Named, not numbered. A named thing is a thing you choose; a numbered thing is a setting
you tolerate.

---

## Phase 3 — The shell

### 3.1 Rebuild the switcher

Today: three separate hit targets in a 140px cluster, two of them unlabelled gradient
squares, in a `role="menu"` with no menu keyboard model. Three of the four gradients start
on the same blue, so the mark is decoration rather than identification. And the home page
uses Lucide glyphs for the same four modules — two visual languages for one concept.

Becomes:

- **One mark, one target.** The module's gradient as the field, its Lucide glyph knocked
  out in white. Home is the first row of the menu, not a second square.
- **Live counts on every row** — "6 open pursuits", "3 due today", "2 to review". The
  switcher is the only surface that can answer *"is anything happening in the workspaces
  I am not looking at"*. Extract `loadModuleCounts()` from the home page and share it.
- **Return to where you were** in a workspace, not to its home page.
- **A real menu keyboard model** — roving tabindex, arrows, Home/End, focus return.
- **`⌘K` to open, `⌘1`–`⌘4` to jump.** In a four-workspace app this is the highest
  value-to-effort item in the entire plan.

### 3.2 Fix the nav on a phone

Nothing in any top bar has a breakpoint. On a 375px screen the jobs bar is a switcher, ten
section links and four icons, and the sections get about 100px of unmarked scroll strip —
with **no scroll affordance and no `scrollIntoView` on the active tab**, so you can land on
`/jobs/review` with its own tab off-screen and no cue it exists.

This is the worst UX defect in the app.

- Edge fade on the scroll container.
- `scrollIntoView({ block: 'nearest', inline: 'center' })` on the active item at mount.
- Overflow menu past eight items. **Jobs has ten sections and needs grouping** — Answers,
  Activity and Review are arguably one thing.

### 3.3 Decide the bell

`components/shell/notifications-button.tsx` is a well-built shell that has never had
anything to say, on three of four navs. The comment defends this — *"inventing some would
teach the user to ignore it"* — and the logic is sound but the conclusion is backwards: a
permanently empty bell **already** teaches that lesson.

Meanwhile every event it should carry is currently shouted as a full-width page banner.
So: wire it, and demote the banners. The events already exist —

- a sync finished, and what it found;
- a return window closes in *n* days;
- an interview tomorrow with no prep notes;
- the vault token expired, nothing mirrored since a date;
- the review queue crossed a threshold.

If wiring it is not in scope this quarter, **remove it until it is**. Furniture is the one
outcome not on the table.

### 3.4 Popover focus management

`role="dialog"` with no `aria-modal`, no focus trap, no initial focus and no focus return,
in both the notifications and feedback panels. Escape and outside-click are handled well;
the keyboard contract is not handled at all.

### 3.5 Sign out on `/account`

`signOut` exists in exactly two places: `app/shopping/settings/page.tsx` and the onboarding
layout. **A user who switches Shopping off in Account settings has no way to sign out.**
Small diff, real bug — an account-level action cannot live inside a module.

---

## Phase 4 — States

### 4.1 Loading

Zero `loading.tsx` files, zero `<Suspense>` boundaries, and exactly one use of the
`.skeleton` utility across the whole app — while every page runs four to seven database
round-trips before rendering anything (`app/shopping/settings/page.tsx` does seven). The
shimmer utility in `globals.css` is beautifully written and essentially unused.

Every route group gets a `loading.tsx` rendering **the page's real shape** — header, rail,
three rows — not a centred spinner. Slow independent regions get `<Suspense>` so a chart
cannot hold the page.

Largest perceived-performance win available, and none of it requires touching a query.

### 4.2 Error

No `error.tsx` anywhere. `app/shopping/inventory/page.tsx:213` does `if (error) throw
error` straight into the framework's default screen. One per route group, saying what
could not be done rather than what the exception was.

### 4.3 Honest failure, everywhere

`app/todo/page.tsx` already does this perfectly — *"Job search could not be read just now,
so anything from it is missing from this page"* — with the reasoning written down:
silently showing a shorter agenda looks exactly like a quiet day. Generalise it. Any page
reading a source that can fail independently says so when it does.

---

## Phase 5 — Page-level corrections

### 5.1 Filter chips and clear-all

`/shopping/inventory` can carry seven simultaneous filters (`q`, `category`, `merchant`,
`list`, `range`, `sort`, `group`, `person`) and the only way to see what is applied is to
scroll the rail looking for tint. A removable-chip row under the page header, on every
page with a rail.

Also: inventory mixes instant-apply rail links with selects that need an Apply button.
One model — submit on change.

### 5.2 Tabs into the URL

`app/jobs/(app)/roles/[id]/panels.tsx` has six tabs of substantial content in
`useState` — not linkable, not back-button-safe, lost on refresh. The one deep link that
exists (`?tab=posting`) only seeds initial state, so it breaks silently after any
interaction. This is the one place the app contradicts its own law 5.

### 5.3 A keyboard and touch path for the pipeline

HTML5 `draggable` with no keyboard alternative and no touch support — on the interaction
the code itself calls *"the most-used interaction in the app"*. `StatusPicker` already
exists as the alternative; put it on the card.

### 5.4 Tables on a phone

`overflow-x-auto` with `min-w-[720px]` and no edge fade is a table with hidden columns.
Add the fade; below `sm`, a table with more than four columns becomes a list.

### 5.5 Star ratings

`'★'.repeat(n)` with no accessible label and no empty stars — "★★★" does not tell you it
is out of five. Appears on the pipeline card and the roles table.

---

## Phase 6 — Alive

Only after everything above. These are the ideas a large product would not ship, and each
is a setting that defaults to calm.

| | What | Why it is safe here |
|---|---|---|
| 6.1 | **The status line** — a persistent monospace ticker of what the system just did | The app's whole job is background ingestion. It replaces most of what the bell would shout, and it directly serves law 2. Start here; it is the most useful item on the list. |
| 6.2 | **The quiet-day sigil** — a mark generated from `hash(user_id + date)`, shown only when you are *finished* | Occupies a moment that is otherwise dead space. Never near data. One inline SVG. |
| 6.3 | **Hold ⌘ for key hints** — shortcuts appear on the actual controls, not in a modal cheat-sheet | Fastest way anyone learns a keyboard-driven app. Rarely built because it is fiddly, not because it is wrong. |
| 6.4 | **The density dial** — comfortable / snug / dense, live in the bar | One variable, three values. "How much do I want to see" genuinely changes between reading a note and working a queue of forty. |
| 6.5 | **Marginalia** — pin a note anywhere, at a slight angle, keyed to the page path | The most "your own homepage" idea in the system. Lays out in a margin column; never overlaps content. |
| 6.6 | **Seams mode** — reveal where every number came from | Law 2 taken to its end: an app that refuses to lie by omission should be able to show its working on demand. |
| 6.7 | **Sound** — one soft click on completion, under 80ms, off by default | Riskiest item on the list, hence the strictest rules. Never on load, never on error. |

---

## Per-workspace punch list

Things specific to one workspace, to fold into whichever phase touches that area.

### Shopping
- **`/shopping/sell` needs a real hierarchy.** Nine stacked blocks — header, settings form,
  stat line, note, test button, estimate button, import button, queue, two sections — with
  no visual structure. It reads as a control panel assembled feature by feature. Split it:
  setup (collapsed) versus the queue (the actual job).
- **The review queue is the app's most consequential page** — unattended, the dashboard
  goes quietly wrong — and it is a flat list with five same-weight `sm` buttons per row.
  Make Confirm and Discard visually asymmetric, and give it a keyboard flow, since it is a
  queue you are meant to work through.
- Raw `text-amber-700` on the "Order to confirm" flag (covered by 1.2).

### Jobs
- **Ten sections.** Group them (3.2).
- Tabs into the URL (5.2), keyboard drag (5.3), star labels (5.5).
- `panels.tsx` is ~1500 lines with 15 hand-written cards. The `Card` migration (1.1)
  should start here.
- **Two charting approaches** — hand-built `<div>` bars in analytics, Recharts on the
  shopping dashboard. Pick one and write down when each is used.

### Vault
- **The thinnest module, and it shows.** Two nav items, one of which is Settings — the only
  workspace where Settings is a section rather than the gear. Fixed by 1.3.
- **No folder tree.** A vault is a hierarchy rendered here as a flat list of flat groups.
  The `LeftRail` already exists and is the obvious home for it.
- **No backlinks.** The note page already builds a full link index to resolve outgoing
  `[[wikilinks]]`; the reverse index is nearly free, and backlinks are the one feature that
  makes a vault feel like a vault rather than a file list.
- Search results are not excerpted at the match, so you cannot see *why* something matched.
- `note.excerpt` is `truncate` on the list where `line-clamp-2` would use the width it has.

### Todo
- No notifications button (1.3).
- **Clicking a title swaps the row for an inline edit form**, which shifts the layout
  mid-list and loses the scroll anchor. Keep the no-detail-page stance — *"a task with a
  detail page is a ticket"* is right — but make the swap not move everything below it.
- No bulk actions. A list where you clear ten things needs a way to clear ten things.
- The four status filters on `/todo/all` use pill styling identical to the top-nav
  sections: two levels of navigation at one visual weight.

---

## Not doing

- **A component library.** The primitives in `components/ui/` are the right size. This
  plan makes them usable; it does not turn them into a design-system package.
- **Replacing Tailwind, or adding a CSS-in-JS layer.** Tokens in `@theme` plus
  `data-theme` selectors covers everything here.
- **A redesign.** Nothing in this plan changes what a page is *for*. The information
  architecture is good; it is the infrastructure and the personality that are missing.
- **Mobile-first.** This is a desktop tool that must not be *broken* on a phone. Those are
  different bars and the second one is the one being met.

---

## Sequencing at a glance

```
Phase 0  tokens · contrast · type scale · checker      ← everything depends on this
Phase 1  Card · Banner · WorkspaceNav · rail · Field   ← removes the drift permanently
Phase 2  Paper + Ink · workspace accent · grain · 3 themes
Phase 3  switcher · mobile nav · the bell · focus · sign-out
Phase 4  loading · error · honest failure
Phase 5  filter chips · tabs in URL · keyboard drag · tables · stars
Phase 6  status line · sigil · key hints · density · marginalia · seams · sound
```

0 and 1 are the whole game. Everything after them is either cheap or optional, and none of
it is safe before them.

## When this is done

- No raw Tailwind palette colour anywhere in `app/` or `components/`.
- Every text pair clears 4.5:1 in all five themes, enforced in CI.
- One top bar, one page header, one left rail, one card, one banner, one field.
- Every route group has a loading and an error state.
- Filters, search, sort and tabs are all in the URL, everywhere.
- The app is usable, and looks deliberate, at 375px.
- Every action is reachable from a keyboard.
- And it looks like it belongs to somebody.

/**
 * The behavioural half of the standard, as data.
 *
 * `laws.ts` is what the interface may claim and how much of itself it may
 * show. This is how it behaves: what a keystroke does, what waits and what
 * does not, what earns an interruption, how a list of five hundred is found
 * in, what the app sounds like. It used to live in a static HTML file in
 * docs/, which meant the page that rendered the real tokens described how the
 * app looked and a document nobody opened described how it behaved -- and
 * behaving well is the half that decides whether a tool is good to use.
 *
 * Data rather than JSX for the same reason the laws are: a checklist, a
 * prompt or a test can quote a rule from here and be quoting the standard.
 * Every list below is rules, not status. Where the app falls short of one,
 * that is a note in the ideas list or a step in the plan, not a caveat here.
 */

/** A row of a small table: the first cell is the thing, the rest describe it. */
export type Row = readonly string[];

// ---------------------------------------------------------------------------
// The four loops
// ---------------------------------------------------------------------------

export const LOOPS_LEAD =
  'Every workspace runs some subset of the same four-beat loop. Naming them is what stops a page from quietly becoming the wrong kind of page — the failure that turns an agenda into an archive, and a review queue into a list nobody works.';

export const LOOPS: readonly Row[] = [
  [
    'Capture',
    '"Get this out of my head, or my inbox."',
    'Must cost almost nothing. One field, always reachable, never a page transition. Ingestion counts as capture: mail arriving is the user capturing.',
  ],
  [
    'Triage',
    '"Is this real, and is it mine?"',
    'A queue with a keyboard rhythm and a default. Every item leaves the queue in one keystroke. An unworked triage queue is how the data quietly becomes wrong.',
  ],
  [
    'Act',
    '"Do the thing."',
    'The action is on the row. Nothing that can be done from a list should require opening a detail page.',
  ],
  [
    'Review',
    '"Is this working?"',
    'Aggregates, cohorts, funnels. Honest about sample size and about what is too young to mean anything.',
  ],
];

export const LOOPS_RULES: readonly string[] = [
  'Every loop needs an entry point at most one click from anywhere in its workspace.',
  'The page that answers "what do I do" is never the same page as the one that answers "what is going on". The agenda and the job search’s Today page are the model.',
];

// ---------------------------------------------------------------------------
// Where am I, and how do I get back
// ---------------------------------------------------------------------------

export const WAYFINDING: readonly string[] = [
  'Three levels, and that is the budget: workspace → section → thing. If you need a fourth, it is a tab inside the thing, not a deeper route.',
  'Every page answers "where am I" without reading a word — the workspace accent, the mark, the active section.',
  'A detail page names its way back to the specific list you came from, with its filters intact, not to a generic parent.',
  'The browser back button is a first-class control. This is most of why law 5 exists: if back does not undo the last view change, the view change was written in the wrong place.',
  'Never a modal for anything with content in it. Modals cannot be linked, cannot be back-buttoned, and trap on a phone. Popovers for menus; pages for content; inline expansion for detail.',
];

// ---------------------------------------------------------------------------
// Latency
// ---------------------------------------------------------------------------

export const LATENCY_LEAD =
  'Three tiers, and every interaction is assigned to one deliberately. Optimistic without a visible failure path is a lie: every optimistic write has its second half — revert, and say why — written in the same commit.';

export const LATENCY: readonly Row[] = [
  [
    'Instant',
    'No perceptible delay.',
    'Filters, sort, tabs, expand and collapse, theme, density.',
    'Client-side, or a server round-trip the interface does not wait for.',
  ],
  [
    'Optimistic',
    'Done immediately; reverts loudly if it fails.',
    'Check a task, move a card, pin, snooze, toggle a preference.',
    'useOptimistic plus a server action. On failure: revert and say why, in place.',
  ],
  [
    'Pending',
    'Visibly working.',
    'Anything creating a row, sending mail, or hitting a third party.',
    'A disabled control with its own label — "Saving…", "Importing…". Never a full-page spinner.',
  ],
];

// ---------------------------------------------------------------------------
// Undo beats confirm
// ---------------------------------------------------------------------------

export const UNDO_LEAD =
  'A confirm dialog asks the user to predict the consequences of an action they have not seen yet. An undo lets them look at the result and change their mind. Undo is almost always the better design, and it is faster in the common case, which is the case where they meant it.';

export const UNDO: readonly Row[] = [
  [
    'Reversible, low blast radius',
    'Complete, drop, snooze, dismiss, mark returned.',
    'Do it, then offer undo in the toast: bottom left, six seconds, at most two at once.',
  ],
  [
    'Reversible but expensive to reverse',
    'Delete an order, remove a pursuit.',
    'Soft delete plus an undo, and a recoverable list in settings.',
  ],
  [
    'Genuinely irreversible',
    'Delete the account, revoke a grant, disconnect a mailbox.',
    'An inline two-step confirm that names what will be lost. Never window.confirm.',
  ],
];

// ---------------------------------------------------------------------------
// Bulk
// ---------------------------------------------------------------------------

export const BULK_LEAD =
  'A list where you routinely act on ten things needs a way to act on ten things. Without one, clearing a triage backlog is forty individual clicks, which is precisely why triage backlogs do not get cleared.';

export const BULK: readonly string[] = [
  'Selection appears on hover of the row’s left edge, not as a permanently visible checkbox column that taxes every ordinary scan. On touch it is always visible.',
  'Shift-click extends a range. ⌘-click toggles one. x selects the focused row.',
  'A selection turns the page header into an action bar — "3 selected · Confirm · Discard · Clear" — replacing the header rather than stacking below it.',
  'Esc clears the selection. Always.',
  'A bulk action gets one undo for the whole batch, not one per row.',
];

// ---------------------------------------------------------------------------
// The keyboard model
// ---------------------------------------------------------------------------

export const KEYBOARD_LEAD =
  'Not a bag of shortcuts: a small, consistent model that generalises. A queue you are meant to work through must be workable without the mouse.';

/** The key, then what it means everywhere. */
export const KEYBOARD: readonly Row[] = [
  ['⌘K', 'Go anywhere, do anything. The one entry point worth memorising.'],
  ['⌥1 – ⌥9', 'Jump to a section of this workspace, in the order the column lists them.'],
  ['/', 'Focus this page’s search.'],
  ['j / k, ↑ / ↓', 'Move through the rows of the current list.'],
  ['Enter', 'Open the focused row.'],
  ['x', 'Select the focused row.'],
  [
    'e',
    'The list’s primary verb on the focused row: complete a task, confirm an order, advance a pursuit.',
  ],
  [
    'Esc',
    'Back out one level: close the popover, clear the selection, blur the search, leave the confirm.',
  ],
  ['⌘Z', 'Undo the last undoable action.'],
  ['hold ⌘', 'Show every shortcut, on the controls themselves.'],
];

// ---------------------------------------------------------------------------
// Search is one system
// ---------------------------------------------------------------------------

export const SEARCH: readonly string[] = [
  'Search implementations may differ in backend and must agree in behaviour.',
  'Always a GET form underneath, enhanced with debounce, never replaced by it.',
  'The query lives in ?q=, and typing uses replace, so a search does not leave one history entry per keystroke between you and the page you came from.',
  'Say what was searched and how: "12 notes matching ‘kettle’". If results are relevance-ranked, say so and disable the sort control.',
  'Show why a row matched — an excerpt around the hit, with the term marked. A result list that hides the match makes the user open every row to find out.',
  'A search with no results is a filtered empty state, never a blank area.',
  '⌘K searches across workspaces; the page field searches within. Two scopes, two entry points, no ambiguity.',
];

// ---------------------------------------------------------------------------
// Forms: the save model
// ---------------------------------------------------------------------------

export const SAVE_MODEL: readonly string[] = [
  'Pick one model per surface and make it obvious which. Settings-shaped things autosave on blur with a quiet "saved" in the toast. Object-shaped things — an order, a role — have an explicit Save. Never mix them in one panel.',
  'Validate on blur, not on keystroke. Telling someone their email is invalid while they are still typing it is scolding them for not having finished.',
  'Re-validate and show every error on submit, and move focus to the first one.',
  'Never lose typing. A form with unsaved changes warns before navigation; a multi-step form keeps its state in the URL or in storage.',
  'Server errors land on the field that caused them where possible, and in the form’s banner only when they genuinely belong to the whole form.',
  'One primary button per view. If two things look equally primary, neither is. Danger is never the primary of a form.',
  'A button that triggers async work shows its own pending label and disables. It never leaves the user guessing whether the click landed.',
];

// ---------------------------------------------------------------------------
// Cross-workspace flow
// ---------------------------------------------------------------------------

export const CROSS_WORKSPACE_LEAD =
  'This is the app’s actual differentiator. A return window closing is a shopping fact, a job follow-up is a jobs fact, and the agenda shows both without owning either.';

export const CROSS_WORKSPACE: readonly string[] = [
  'Nothing is ever copied. The borrower reads from the workspace that owns the row, at render time, and writes back to it when you act.',
  'The owning workspace is always named and always reachable from the borrowed row. A row you cannot trace back to its source is a row you cannot trust.',
  'Acting on a borrowed row writes to the owner, and the owner’s own page shows the change immediately. There is no second state to reconcile.',
  'A source that fails is named, not omitted. Law 2, and the single most important rule on any page that reads more than one schema.',
  'A borrowed row is never editable in the borrower. You can act on it — snooze, complete, dismiss — but you rename it where it lives.',
  'Every source is switchable off, and everything except your own list starts off. A cross-workspace feature that opts you in floods the page you rely on.',
];

// ---------------------------------------------------------------------------
// The three places the app speaks
// ---------------------------------------------------------------------------

export const PLACES: readonly Row[] = [
  [
    'The brief',
    'Middle of the top bar.',
    'What is true of your data right now, on this page.',
    'Exactly one line, the most urgent one; first match wins. A brief that lists three things is a dashboard, and there is already a dashboard. Silence is a valid answer and the common one.',
  ],
  [
    'The status line',
    'Bottom of the shell.',
    'What the system just did, unprompted.',
    'Machine voice: monospace, lower case, no full stop. Moves nothing, blocks nothing, is not addressed to you, and fades back after a few seconds.',
  ],
  [
    'The palette',
    '⌘K.',
    'Where do I want to be, and what do I own.',
    'Places first, always instant; things you own arrive after, and never hold the places up. Every row carries the mark of where it lives.',
  ],
];

// ---------------------------------------------------------------------------
// The attention ladder
// ---------------------------------------------------------------------------

export const LADDER_LEAD =
  'What earns an interruption, from cheapest to most expensive. Use the lowest rung that works; each rung up costs the user more and can only be spent so often.';

export const LADDER: readonly Row[] = [
  ['Status line', 'Nearly free.', 'Anything the system did on its own. The default rung.'],
  [
    'A count on a nav item',
    'Cheap, but permanent until cleared.',
    'A queue whose neglect corrupts data. Review, and almost nothing else.',
  ],
  [
    'An entry in the bell',
    'Cheap, deferred.',
    'Something you will want to know about, but not right now.',
  ],
  [
    'An in-page banner',
    'Moderate — it moves the layout.',
    'This page is not telling you the whole truth right now. Only that.',
  ],
  ['A blocking dialog', 'Expensive.', 'Irreversible destruction, and consent. Nothing else, ever.'],
];

export const NOTIFICATION_RULES: readonly string[] = [
  'The bell only exists once it has something to say. A permanently empty panel teaches people to stop looking.',
  'A notification is one line, written as the thing that happened, with a link to where it happened. "Your Amazon return window closes Friday", never "You have 1 new notification".',
];

// ---------------------------------------------------------------------------
// Finding one row in five hundred
// ---------------------------------------------------------------------------

export const FINDING: readonly string[] = [
  'Sort, filter, group and search are four different questions, and a list of any size needs all four, from the URL.',
  'Group headers carry a subtotal. A group you cannot total is a group that only reorders the problem.',
  'The default order answers the page’s own question. An agenda sorts by when it runs out. An archive sorts by recency. A vault sorts by path, because a git tree carries no timestamps.',
  'Never paginate what can be virtualised, and never virtualise what fits. Pagination is a last resort: it breaks ⌘F, which is the tool people actually reach for.',
  'A row is one strong line, one supporting line at most, and one number. A third line means the row is trying to be a detail page.',
  'Every page with a filter rail shows the active filters as chips under the header, each removable, with Clear all. Seven filters you can only see by hunting the rail for tint is a page that lies about what it is showing.',
];

// ---------------------------------------------------------------------------
// First run
// ---------------------------------------------------------------------------

export const FIRST_RUN: readonly string[] = [
  'A new account is empty on every surface, so every surface has its empty state written before it ships.',
  'Onboarding asks for exactly one thing and explains what it gets you before it asks. The Gmail pre-consent screen is the model.',
  'Skip is always available and never punished. A workspace that will not open without a connected mailbox loses the person who wanted to try it.',
  'The empty-to-full transition is a designed moment. A first sync mid-flight says so, says what it has found so far, and does not pretend to be finished.',
];

// ---------------------------------------------------------------------------
// Touch
// ---------------------------------------------------------------------------

export const TOUCH: readonly string[] = [
  'Nothing depends on hover. Row actions are visible on touch and revealed on hover: opacity-100 sm:opacity-0, not the other way round.',
  'Nothing depends on drag. Every drag has a menu equivalent on the same object.',
  '44px targets, or 44px of clear space around a smaller one. Controls are 36px on a phone and shrink only once there is a pointer’s worth of precision.',
  'Sheets, not popovers, below sm — pinned to the viewport, not anchored to a button three-quarters of the way across the screen.',
  '16px inputs, always, or iOS zooms the page on focus and the layout you designed is gone.',
  'The primary action is reachable with a thumb. On a phone the sections are a bar of tabs along the bottom, with the workspace switcher in the centre slot.',
  'Below md a table stacks each row into label and value pairs. A five-column table scrolling sideways on a phone is not a design.',
];

// ---------------------------------------------------------------------------
// Surfaces: which shape, and the rules each shape carries
// ---------------------------------------------------------------------------

export const PAGE_WIDTHS: readonly Row[] = [
  [
    'Full, 1400px',
    'Set by the shell.',
    'Anything with a filter rail, a table, a board or a card grid.',
  ],
  [
    'max-w-3xl',
    'Read top to bottom in one column.',
    'An agenda, all tasks, a note, a role, this page.',
  ],
  ['max-w-2xl', 'A single focused form.', 'A new order, a new role, onboarding.'],
];

export const SHAPES: readonly Row[] = [
  [
    'List',
    'Scanning one thing per row. The row has an identity and a couple of facts.',
    'Inventory, orders, notes, returns, the agenda.',
  ],
  [
    'Table',
    'Comparing across columns; sorting matters; four or more parallel values.',
    'Roles, companies, interviews, analytics.',
  ],
  ['Card grid', 'The image is the identifier.', 'Saved items, the home tiles.'],
  ['Board', 'Position is the state and moving is the primary verb.', 'The pipeline only.'],
  [
    'Figure',
    'The one number the page is about, on the page ground, at most once per page.',
    'Spend this month.',
  ],
];

export const ROW_RULES: readonly string[] = [
  'The whole row is the link: a stretched pseudo-element over the row, so the hit area is the row and not the six characters of the title, and a middle click still opens a tab.',
  'Name first in ink, its qualifier muted after it on the same line, joined by · and truncating as one line, then the numbers right-aligned in tabular figures.',
  'Actions live at the far right, revealed on hover for pointers and always visible on touch.',
  'A destructive row action confirms in place, in two steps, never in a dialog.',
];

export const TABLE_RULES: readonly string[] = [
  'Headers are the small uppercase label, once. Sortable headers are links that write ?sort=, with the active one in accent and an arrow. A table with more than ten rows is sortable.',
  'Numeric columns are right-aligned and tabular. Always.',
  'A row with one destination goes there from anywhere in the row, and says so under the cursor.',
  'Row height follows the density dial.',
];

export const FILTER_RULES: readonly string[] = [
  'Every rail item is a link that writes a query parameter, never local state. Counts on the right, a swatch or glyph on the left, aria-current on the active one.',
  'One interaction model per filter surface: instant. A select submits on change, and its Apply button exists only for the page without JavaScript.',
  'Below lg the rail is a sheet, not a stack of filters shoved above the content you opened the page to read.',
];

export const BANNER_TONES: readonly Row[] = [
  ['info', 'Something is happening that you did not start and need not act on.', 'accent tint'],
  [
    'warn',
    'Something is wrong and only you can fix it. Always carries the action.',
    'caution tint',
  ],
  ['bad', 'A source failed. This page is incomplete and says so. Law 2.', 'danger tint'],
  ['good', 'Money came back. Nothing else.', 'positive tint'],
];

// ---------------------------------------------------------------------------
// Data display
// ---------------------------------------------------------------------------

export const DATA_LEAD =
  'Five components draw every number in the app. Law 7 governs the ink — plain, tabular, no colour, no motion beyond a count-up. These govern the arithmetic: what each one is allowed to claim, and what it has to say when it cannot claim it.';

export const DATA_DISPLAY: readonly Row[] = [
  [
    'Figure',
    'One per page, and it is the reason the page exists.',
    'Not in a card, because a card says “one of several things here”. It stands on the page ground at the top of the type scale, with the line that makes it reconcile hung underneath and the numbers that would each have taken a card in the quiet row below the rule.',
  ],
  [
    'FigureDelta',
    'Names the period it compares against, or says there is none.',
    'Green only where money came back, so a falling spend is the only delta that earns it; a rising one is plain ink, a fact rather than an alarm. With nothing to compare against it reads “No prior period to compare”.',
  ],
  [
    'Sparkline',
    'A shape rather than a chart. Its accessible name carries the window.',
    'Fifty-two pixels wide, unlabelled and unaxed: rising, falling, spiky, flat. A flat series sits on the baseline, because one purchase must not draw the line that steady spending draws.',
  ],
  [
    'Meter',
    'One quantity against the quantity it is part of.',
    'The exact value is read from the figure beside it; the length is for comparing rows in a single pass. Where a row must stay visible however small it is — one application in four hundred — the caller sets a floor and a non-zero value draws a sliver. The accessible name says both halves of the claim.',
  ],
  [
    'ReturnFuse',
    'A window emptying, against the real length of that window.',
    'Colour and thresholds come from the four deadline states in lib/health.ts, and the fourteen days that put a return in “Due soon” are the same fourteen that put the fuse in its at-risk state. The bar and the filter cannot drift apart, because there is one copy of each number.',
  ],
];

export const TIME_AS_LENGTH =
  'Time is drawn as a length wherever it is running out. "Returns by 14 Sept" asks you to subtract today from a date every time you scan the row; a bar that empties as the window closes is the same fact without the arithmetic. The denominator is always the real window — a fuse against an invented length is a picture of a number nobody has — and where the window is unknown there is no bar at all.';

export const DATA_RULES: readonly string[] = [
  'A statistic too young to mean anything is not drawn as a number. FigureDelta reads “No prior period to compare” instead of 0%, and a month in the jobs cohort table reads “too early” until its newest applications are past the response window, rather than printing a rate that would make recent effort look like failure.',
  'A denominator that does not exist is never invented. No window, no fuse; no prior period, no delta; nothing above zero, no percentage.',
  'Where none of the colour meanings is true, a bar is ink and a length. The fuse spends its two calm states that way — ghost while there is more than a fortnight left, full ink inside the last fortnight — because getting on with it is not a warning.',
];

export const STATES: readonly Row[] = [
  [
    'Empty',
    'Branches on whether a filter is applied, and each branch gets its own copy and its own action. Filtered: "No matching items" and Clear filters — never suggest creating something when they were searching for it. Genuinely empty: say what will fill it and offer the action that does. Finished: a reward, not an absence, with the quiet-day sigil and no call to action.',
  ],
  [
    'Loading',
    'Skeletons, never spinners. Every route has a loading file that renders the page’s real shape — the header, the rail, a few rows — so the layout does not jump when the data lands. Slow, independent regions sit in their own Suspense boundary so a slow chart does not hold the page. A skeleton that would show for under 200ms is a flicker: delay it.',
  ],
  [
    'Error',
    'Every route has an error file. A partial failure is stated in place and never silently swallowed: "Job search could not be read just now, so anything from it is missing from this page" is the model. An error says what could not be done, not what the exception was, and if there is a retry it is a button.',
  ],
];

export const SHELL_RULES: readonly string[] = [
  'One shell. The sidebar holds the workspace switcher at its top, the sections under it, and the workspace’s own settings at its foot; the top bar names the page, carries the brief, and holds what belongs to the account rather than to the page.',
  'A setting belongs to the account if it would still mean anything with the module switched off — your name, timezone, currency, theme. Everything else belongs to the module it is about.',
  'The active section is a ground plus a 2px bar in the workspace mark’s own fixed hue, so it is vivid on every shell. aria-current="page" on it, always.',
  'A badge only where an unattended count causes silent data damage. Review has earned one. Nothing else has. Dark ink on the caution fill, never white on orange.',
  'The switcher is one mark, one label, one chevron, one hit target, and every row of its menu carries a live count. The current module is always listed, even when switched off.',
  'A popover: a 32px trigger with aria-expanded, a raised panel, closes on Esc and outside click, focus moved in, trapped, and returned to the trigger. Below sm it pins to the viewport rather than to the trigger.',
];

export const ICON_RULES: readonly string[] = [
  'Lucide, 1.75 stroke, currentColor, never filled. One library, one weight, no exceptions.',
  '16px in rows, nav and buttons; 14px inside a chip or a badge; 20px in the phone dock and in an empty state; nothing larger.',
  'Never an emoji as an interface icon. Emoji render differently on every platform, cannot take a colour or a stroke, and carry a tone this app does not have. They are fine inside a user’s own note.',
  'A decorative icon takes aria-hidden. An icon that is the control takes an accessible name.',
];

export const THEME_RULES: readonly string[] = [
  'A theme is a ground, an ink, a border and a mood. Everything else is derived. A theme small enough to read in one screen is one a person could plausibly write themselves, which is the only reason to have more than two.',
  'Themes are named, not numbered. A named thing is a thing you choose; a numbered thing is a setting you tolerate.',
  'Default follows the system until the user picks. The choice lives on the account and is mirrored into a cookie so the server paints the right theme in the first byte. A theme that flashes white before going dark is worse than no dark mode.',
  'Every theme passes the same contrast gate. There is no expressive-theme exemption.',
  'Lightbox is the one theme whose page and cards disagree on purpose: a dark bench with lit sheets on it, two inks on screen at once. An element that paints a sheet under itself gets the sheet’s ink; everything else stands on the page and gets the page’s. Nothing outside globals.css has to know.',
  'One fixed grain layer over the whole viewport, pointer-events none, tuned per theme. It never sits between the reader and prose they are reading closely, and never inside a chart or a table.',
];

// ---------------------------------------------------------------------------
// Alive
// ---------------------------------------------------------------------------

export const ALIVE_LEAD =
  'The things a big product would not ship. Each is deliberately outside what a large team could justify, each obeys law 7 — chrome, never data — and each is a setting that defaults to the calm option. A person who turns all of it off still gets a precise, contrast-correct tool: that is the floor, and these are the ceiling.';

export const ALIVE: readonly Row[] = [
  [
    'The quiet-day sigil',
    'A small mark generated from the account and the date, drawn in the workspace accent, shown in exactly one situation: the page is empty because you are finished. The same date gives the same mark forever, so it is a fact about the day rather than a random flourish.',
  ],
  [
    'The status line',
    'One line at the bottom of the shell, in machine voice, saying what the system did while nobody was looking. Never taller, never blocking, fades back after a few seconds.',
  ],
  [
    'Hold ⌘ to see everything',
    'Hold a modifier and every shortcut appears on the control it drives, then vanishes when you let go. You learn the keyboard by looking at the thing you were about to click.',
  ],
  [
    'The density dial',
    'Comfortable, snug, dense, in the top bar, moving every card, row and control together by scaling a handful of variables. The dial only ever takes away.',
  ],
  [
    'Marginalia',
    'Not yet. A note pinned anywhere, on any page, at a slight angle, that belongs to the page path and is still there next time. Rotation at most 2°, from a hash of the note id so it never jitters; a hard offset shadow because it is paper; never over content.',
  ],
  [
    'Seams',
    'Not yet. A toggle that reveals where every number came from — this figure is 14 orders from two inboxes, last synced 09:12. Law 2 taken to its end. Off by default; on, provenance is a dotted underline with the detail on hover and focus.',
  ],
  [
    'Sound',
    'Not yet. One short, soft click when something completes. Under 80ms, never on load, never for errors, off unless explicitly enabled.',
  ],
];

// ---------------------------------------------------------------------------
// Accessibility contract
// ---------------------------------------------------------------------------

export const A11Y: readonly string[] = [
  '4.5:1 for text and 3:1 for a control’s border, in every theme. Machine-checked on every push.',
  'Visible focus: a 2px accent outline at 2px offset on every interactive element. Never outline: none without a replacement.',
  'Every interactive element is reachable and operable from a keyboard. Every drag has a keyboard and touch path on the same object.',
  'Popovers and dialogs: aria-modal, focus moved in, trapped, and returned. Menus get a real menu keyboard model with roving tabindex.',
  'Icon-only controls carry an accessible name. A title alone is not a name.',
  'Never colour alone. A status is a word, or a shape with a word beside it, not a bare dot.',
  'Touch targets are 44px or have 44px of space around them.',
  'aria-current="page" on every active nav item, rail item and tab.',
  'An error that appears after a submit is announced: role="alert". A control that is busy says so: aria-busy, and its changed label is read out.',
];

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export const VOICE_LEAD =
  'The app talks like a knowledgeable friend who respects your time: plain, specific, unhurried, never chirpy.';

export const VOICE_DO: readonly string[] = [
  'Nothing matched that search across names, tags and categories. You probably don’t own it.',
  'A month is marked too early until its newest applications are 21 days old. Including them would drag every rate toward zero and make recent effort look like failure.',
  'You do not tick off a meeting.',
];

export const VOICE_DONT: readonly string[] = [
  'Oops! No results found 😅',
  'Data unavailable.',
  'Are you sure you want to do this? This action cannot be undone.',
];

export const VOICE: readonly string[] = [
  'Say what happened, not that something happened. "Your Amazon return window closes Friday", not "You have 1 notification".',
  'Explain the rule when the rule is surprising. If a figure excludes something, the page says what and why, in one sentence, next to the figure.',
  'Sentence case everywhere. Title Case is for proper nouns.',
  'No exclamation marks, no "successfully", no emoji in product copy.',
  'Buttons are verbs the user is doing: "Add an order", "Clear filters", "Reconnect the vault". Never "Submit", "OK", "Confirm".',
  'Numbers are formatted, always: money through lib/money.ts, dates in the account’s timezone, never a raw ISO string.',
  'Machine voice — the status line, the toast, a keycap — is monospace, lower case, and has no full stop.',
];

// ---------------------------------------------------------------------------
// Before you ship a surface
// ---------------------------------------------------------------------------

export const CHECKLIST: readonly string[] = [
  'Every colour is a token; every size is a named step; every control height is the dial. The gate passes.',
  'It has been looked at in Paper, Ink and one of Lightbox or Dusk. Nothing disappears, nothing glows.',
  'Numbers in a column are tabular. Money went through lib/money.ts.',
  'Containers are Card, Group or CardSection; banners are Banner; empty states are EmptyState.',
  'The empty state branches on filtered against unfiltered, with different copy and different actions.',
  'A section with nothing in it is not rendered, and a source that could fail says so in place when it does.',
  'Filters, search, sort, group and tab live in the URL and survive a refresh and the back button. Search works with JavaScript off.',
  'There is a loading file rendering this page’s real shape, and an error file.',
  'Every write has a latency tier, and an optimistic one has its failure path in the same commit.',
  'Reversible actions offer undo. Only irreversible ones confirm, in place.',
  'The list can be worked from the keyboard: move, open, select, act, escape. Focus is visible; popovers trap and return it.',
  'Touch: actions are visible without hover, targets are 44px, nothing depends on a pointer. Checked at 390px wide.',
  'The interruption uses the lowest rung of the attention ladder that works.',
  'A borrowed row from another workspace names its owner and is reachable from it. Nothing is copied.',
  'Any new animation is in the reduced-motion block in the same commit. Any flourish is chrome, under a second, and can be switched off.',
  'Icons are Lucide at 1.75 in currentColor. No emoji. No gradient blends two hues.',
  'Every non-obvious decision carries a comment saying why.',
];

/**
 * The nevers that are not already a law. Each of these was a real bug, which
 * is the only reason a rule that short earns a line.
 */
export const NEVER: readonly string[] = [
  'A raw Tailwind palette colour. An emerald straight from the palette is a bug in three themes.',
  'A two-hue gradient anywhere but the home mark.',
  'White text on the caution fill. Dark ink on the fill.',
  'A resting drop shadow on a card. Depth is a hairline; shadow is for things that float.',
  'A second copy of the shell, the page header, the rail, the table or the card.',
  'window.confirm or window.alert.',
  'A spinner where a skeleton of the real shape would do.',
  'A flourish next to a number, or a flourish that cannot be turned off.',
  'Delay the user to be charming.',
];

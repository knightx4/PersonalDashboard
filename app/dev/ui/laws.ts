/**
 * The eight laws, as data.
 *
 * They live in a module rather than in the page's JSX so that the page is a
 * layout and this is the content, and so that anything else that needs to
 * quote a law -- a review checklist, a prompt, a test -- reads the same words.
 * These are the product's character, not style preferences: they are what
 * makes six unrelated workspaces feel like one place.
 */
export type Law = { n: number; title: string; body: string };

export const LAWS: readonly Law[] = [
  {
    n: 1,
    title: 'A quiet day looks quiet.',
    body: 'An empty section is not rendered — no "0 items", no empty card, no skeleton of nothing. Sections appear because they have something to say. A wholly empty page gets a real empty state, and that empty state is allowed to be beautiful.',
  },
  {
    n: 2,
    title: 'Never lie by omission.',
    body: 'If a source failed, say so in place. A short list and a broken list look identical, and that is the worst failure this app can have. Stale mirror, mid-flight sync, a statistic too young to mean anything — the page says it, where it happened.',
  },
  {
    n: 3,
    title: 'Never invent precision.',
    body: 'A task due "Tuesday" shows "Tuesday", not "Tuesday 00:00". A role never matched shows nothing, not "0/0". No prior period shows "No prior period to compare", not "0%".',
  },
  {
    n: 4,
    title: 'Colour is a claim.',
    body: 'Green means money came back — never spending, never generic success. The pipeline hues mean one stage each and appear nowhere else. Workspace accent means "you are here". If you need a colour and none of the meanings is true, use ink and a shape.',
  },
  {
    n: 5,
    title: 'View state lives in the URL.',
    body: 'Filters, search, sort, grouping, tabs, pagination — query parameters, all of them. A narrowed view survives a refresh, the back button, and being pasted into a note. Component state is for the genuinely ephemeral: an open menu, a confirm step, an unsent draft.',
  },
  {
    n: 6,
    title: 'It works before JavaScript does.',
    body: 'Search and filters are GET forms and links. Server components render data. Client components exist for interaction, not fetching. A slow connection degrades to a working page, not a spinner.',
  },
  {
    n: 7,
    title: 'Personality lives in the chrome, never in the data.',
    body: 'Texture, colour, whimsy and motion belong to the frame: nav, empty states, marks, themes, transitions. The numbers themselves are set plainly, in tabular figures, on a clean ground. Decorate the room, not the instruments.',
  },
  {
    n: 8,
    title: 'Reasoning goes in the code.',
    body: 'Every non-obvious decision carries a comment saying why, in the file where it lives. This codebase is unusually good at that and it must stay that way — it is the only thing stopping the next contributor from re-deriving a decision badly.',
  },
];

/**
 * The restraint laws, added after a review of what the app actually looked
 * like rather than what it was supposed to.
 *
 * They are listed apart because the first eight are about truthfulness — what
 * the interface is allowed to claim — and these four are about how much of
 * itself it is allowed to show while claiming it. They are also the ones being
 * broken most, which is the honest reason they had to be written down: nobody
 * sets out to build a wall of boxes, it accretes one reasonable-looking
 * bordered div at a time.
 *
 * Read them together. Density says take less room; collapse says give the room
 * back when you are not using it; borders says stop drawing the room; and
 * forms says the room should not look like paperwork. They are four views of
 * one idea, which is that the interface should get out from in front of the
 * thing the person came for.
 */
export const RESTRAINT_LAWS: readonly Law[] = [
  {
    n: 9,
    title: 'Take up the room the content needs, and no more.',
    body: 'A form asking for four short strings should not fill a screen. Chrome — labels, padding, borders, headings — is overhead paid so the content can be read; when there is more overhead than content, the ratio is wrong. Prefer a placeholder to a label, a fold to a scroll, and one row to three.',
  },
  {
    n: 10,
    title: 'Anything long can be folded away.',
    body: 'A section the reader is done with should be collapsible, and its collapsed line has to carry enough — a count, a total, the one fact it is about — that opening it is a choice rather than a check. A fold that hides whether it is worth opening has moved the work rather than saved it. Collapse with <details>, so it folds before JavaScript loads and a keyboard and a screen reader get it for free.',
  },
  {
    n: 11,
    title: 'A border is the last resort for grouping.',
    body: 'Space groups. Alignment groups. A shared ground groups. A border is what you reach for when none of those can, and a border inside a border is almost always a mistake — the outer one already said "these belong together" and the inner one is arguing with it. If a group inside a card needs marking, give it a heading and space above it, not a second frame.',
  },
  {
    n: 12,
    title: 'Edit the thing, not a form about the thing.',
    body: 'A value and its editor are the same object in the same place at the same size: click the number, type a new one, leave. A labelled field in a bordered panel with its own Save button is what you fall back to when a thing genuinely cannot be edited where it is read — a multi-field create, a destructive change worth confirming. It is not the default, and it is never how one number gets changed.',
  },
];

/**
 * Laws 13 to 15: what a surface is, rather than how it is drawn.
 *
 * All twelve laws above can be satisfied by a screen that still reads badly,
 * and that is not hypothetical -- check:ui went from 111 violations to 0 across
 * 102 files without changing how any page reads. The first twelve govern
 * components. These govern the shape of the page, which is where the weight
 * actually comes from: a list built as a stack of cards, every field arriving
 * in an editor, every heading explaining itself underneath.
 */
export const SHAPE_LAWS: readonly Law[] = [
  {
    n: 13,
    title: 'A row is not a card.',
    body: 'A list is one surface with hairlines between rows, not a stack of cards each carrying its own border, margin and padding. A card row costs about 95px. A line row costs 36px. On a phone that is nine items on screen instead of twenty-five. Cards are for a few things compared side by side; anything scrolled is a list.',
  },
  {
    n: 14,
    title: 'Nothing is in edit mode until someone edits.',
    body: 'A surface shows its values as text. It does not draw an editor around each one, and it does not leave an empty box open for words nobody is typing — an always-open compose box is the single biggest source of form-feel in this app. A box for new text is a button until it is pressed; a value is text until it is clicked. On arrival this app renders 39 textareas, 31 selects and 52 Save buttons, almost all on screens someone came to read. Law 12 says how to edit when you do; this one says not to show the editor before then.',
  },
  {
    n: 15,
    title: 'Do not explain a heading underneath the heading.',
    body: 'A sentence restating the heading above it is read once and skipped forever after. "Submitted — sent, and landed somewhere real" teaches nothing on the second visit. Name the thing correctly instead, and put the explanation in the empty state, where someone seeing it for the first time actually is. Never put a caption above a box whose placeholder says the same words.',
  },
];

/** Kept for the page that renders the ninth on its own. */
export const DENSITY_LAW: Law = RESTRAINT_LAWS[0];

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
 * The ninth law, added after a review of what the app actually looked like
 * rather than what it was supposed to. It is listed apart because the other
 * eight are about truthfulness and this one is about restraint, and because it
 * is the one most recently broken.
 */
export const DENSITY_LAW: Law = {
  n: 9,
  title: 'Take up the room the content needs, and no more.',
  body: 'A form asking for four short strings should not fill a screen. Chrome — labels, padding, borders, headings — is overhead paid so the content can be read; when there is more overhead than content, the ratio is wrong. Prefer a placeholder to a label, a fold to a scroll, and one row to three.',
};

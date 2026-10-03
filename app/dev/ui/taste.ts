/**
 * The person's preferences, as data (docs/UI-QUALITY-SPEC.md, Part 3).
 *
 * The laws in `laws.ts` are general principles. These are narrower: things
 * the person has asked for in their own notes that no law states, such as
 * 12-hour times or one column on a detail page. They sit beside the laws so
 * that `/dev/ui` stays the only description of the interface, and so that
 * the design critic (`.claude/agents/ui-critic.md`) reads them from the same
 * place the page does.
 *
 * Every entry names the note or notes it came from, by where the note was
 * filed and the day. An entry with no source is a guess at the person's
 * taste, and `tests/dev-ui-taste.test.ts` fails it. `example` is a gallery
 * surface id from `app/preview/surfaces.tsx` showing the preference done
 * right; the same test checks it exists.
 *
 * Unlike laws these are not numbered for life: the person can remove one,
 * and one that keeps applying across workspaces can be promoted to a law.
 * The notes routine adds an entry when a note says a request applies
 * "anywhere" or "everywhere", or when the same request comes in from two
 * different pages.
 */

/** One note a preference came from: the page it was filed on and the day. */
export type TasteSource = {
  /** Where the note was filed, as the person would name it. */
  where: string;
  /** The day it was filed, as YYYY-MM-DD. */
  on: string;
};

export type Taste = {
  /** Stable id, for links and for the critic to cite. */
  id: string;
  /** The preference, in one sentence. */
  sentence: string;
  /** The notes it came from. Never empty. */
  sources: readonly TasteSource[];
  /** A gallery surface id that shows it done right. */
  example: string;
};

export const TASTE: readonly Taste[] = [
  {
    id: 'one-column-detail',
    sentence:
      'A detail page is one column: details first, then the long text, then the rest.',
    sources: [{ where: 'Role page', on: '2026-09-30' }],
    example: 'jobs-contact',
  },
  {
    id: 'forward-action-in-reach',
    sentence:
      'The main forward action stays in the same place at phone width, reachable without scrolling.',
    sources: [{ where: 'News', on: '2026-10-02' }],
    example: 'news-quick-story',
  },
  {
    id: 'next-item-preloaded',
    sentence:
      'Anything worked through in sequence has the next item loaded before it is asked for.',
    sources: [
      { where: 'News', on: '2026-09-24' },
      { where: 'News', on: '2026-09-27' },
      { where: 'News', on: '2026-10-02' },
    ],
    example: 'news-quick-page',
  },
  {
    id: 'swipe-shows-next',
    sentence: 'A swipe shows the next item coming in as the current one leaves.',
    sources: [{ where: 'News', on: '2026-10-02' }],
    example: 'news-quick-story',
  },
  {
    id: 'add-is-one-press',
    sentence:
      'Adding something is one press, with details after. No form where a button would do.',
    sources: [
      { where: 'Learn', on: '2026-09-24' },
      { where: 'Contact page', on: '2026-09-29' },
    ],
    example: 'learn-goals-list',
  },
  {
    id: 'urls-are-links',
    sentence: 'Every URL in any text is a link.',
    sources: [
      { where: 'Company page', on: '2026-09-28' },
      { where: 'Goal page', on: '2026-09-29' },
    ],
    example: 'jobs-company',
  },
  {
    id: 'list-boxes-collapse',
    sentence: 'A box that holds a list can be collapsed.',
    sources: [{ where: 'Roles', on: '2026-09-28' }],
    example: 'jobs-recommended-roles',
  },
  {
    id: 'name-opens',
    sentence: "Pressing a thing's name opens it. It never starts editing it.",
    sources: [{ where: 'Goals', on: '2026-09-27' }],
    example: 'goals-steps-tree',
  },
  {
    id: 'twelve-hour-times',
    sentence: 'Times are 12-hour with AM and PM, everywhere.',
    sources: [{ where: 'Calendar', on: '2026-09-27' }],
    example: 'todo-calendar-month',
  },
  {
    id: 'no-bare-text',
    sentence:
      "Text never sits bare on the background, and the person's words, quotes and Dash's words each look different.",
    sources: [
      { where: 'Vault note', on: '2026-09-30' },
      { where: 'Maya', on: '2026-09-30' },
    ],
    example: 'vault-note',
  },
  {
    id: 'opaque-panels',
    sentence: 'Panels over content are opaque enough to read.',
    sources: [
      { where: 'News', on: '2026-10-02' },
      { where: 'Ask', on: '2026-10-02' },
    ],
    example: 'ask-dash-answer',
  },
  {
    id: 'loading-at-once',
    sentence: 'A press that starts loading shows a loading state at once.',
    sources: [{ where: 'Learn', on: '2026-09-28' }],
    example: 'ask-dash-new',
  },
  {
    id: 'fits-one-screen',
    sentence:
      'The important thing fits on one phone screen, with no large gap where an image is missing.',
    sources: [{ where: 'News', on: '2026-09-24' }],
    example: 'news-issue-digest-no-pictures',
  },
  {
    id: 'categories-one-line',
    sentence: 'A row of categories on a phone stays on one line, ending in "More".',
    sources: [{ where: 'News', on: '2026-09-30' }],
    example: 'news-story-grid',
  },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The sources as one line, the way the spec writes them: three notes on News
 * read "News, 24 and 27 Sep, 2 Oct". Notes from the same place are kept
 * together in the order they were listed, and places are split by a
 * semicolon.
 */
export function describeSources(sources: readonly TasteSource[]): string {
  const byPlace = new Map<string, string[]>();
  for (const s of sources) {
    const [, m, d] = s.on.split('-').map(Number);
    const day = `${d} ${MONTHS[m - 1]}`;
    byPlace.set(s.where, [...(byPlace.get(s.where) ?? []), day]);
  }
  return [...byPlace]
    .map(([where, days]) => `${where}, ${joinDays(days)}`)
    .join('; ');
}

/** "24 Sep", "27 Sep", "2 Oct" reads "24 and 27 Sep, 2 Oct". */
function joinDays(days: readonly string[]): string {
  const runs: { month: string; dates: string[] }[] = [];
  for (const day of days) {
    const [date, month] = day.split(' ');
    const last = runs[runs.length - 1];
    if (last && last.month === month) last.dates.push(date);
    else runs.push({ month, dates: [date] });
  }
  return runs
    .map(({ month, dates }) => {
      const head = dates.length > 1 ? `${dates.slice(0, -1).join(', ')} and ${dates.at(-1)}` : dates[0];
      return `${head} ${month}`;
    })
    .join(', ');
}

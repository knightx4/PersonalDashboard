/**
 * The page patterns as the plan reads them (docs/UI-QUALITY-SPEC.md, Part 4):
 * each one's name and the rule the design critic judges a screen against.
 *
 * A step that adds or changes a screen names its pattern in its detail, on a
 * line of its own: "Pattern: list and detail". The brief prints that
 * pattern's rule, and the building session passes it to the critic as the
 * `pattern` input. A step that names a pattern not in this list is asking for
 * a new one, which is the person's to decide.
 *
 * The rules are copied from PATTERNS in app/dev/ui/patterns.tsx, which also
 * draws the gallery fixtures. That file pulls in server actions through the
 * thread, so the CLI and the plan page cannot import it;
 * tests/dev-ui-patterns.test.ts fails when the two lists differ.
 */
export type PatternRule = {
  /** What a step's "Pattern:" line says, lower case. */
  name: string;
  /** Its heading on /dev/ui, where the anchor is #patterns. */
  label: string;
  rule: string;
  /** The file a new screen of this pattern starts from. */
  component: string;
};

export const PATTERN_RULES: readonly PatternRule[] = [
  {
    name: 'list and detail',
    label: 'List and detail',
    rule: 'Both pages are one column at every width. The list is the header with its one action, what the list is narrowed by, one surface of rows, then the count; pressing a row opens it. The item page is the header, then its details as a grid of facts, then its long text, then everything else.',
    component: 'components/patterns/list-detail.tsx',
  },
  {
    name: 'deck',
    label: 'Deck',
    rule: 'One item on screen. The forward action is in the same place on every item, held above the tab bar on a phone. The next item is drawn before it is asked for, so forward shows it at once, and a swipe left brings it in as the current one leaves. When the last is passed the deck says so.',
    component: 'components/patterns/deck.tsx',
  },
  {
    name: 'thread',
    label: 'Thread',
    rule: "The thread sits on one card with the row it is about. The row's name comes first and opens the row, then its state, then the turns oldest first on the card's own ground, Dash's on a recessed ground of their own, and the box last, closed until it is pressed.",
    component: 'components/patterns/thread.tsx',
  },
  {
    name: 'tabbed detail',
    label: 'Tabbed detail',
    rule: 'Breadcrumbs first, then the title, then the tabs, then the open tab. Each tab is a link that puts the tab in the address, so a reload, the back button and a pasted link open the same tab, and the first tab is the plain address. The properties sit in a column on the right from laptop width and stay in view while the tab scrolls; on a phone they are a grid of facts between the title and the tabs. The row of tabs stays on one line at every width.',
    component: 'components/patterns/tabbed-detail.tsx',
  },
  {
    name: 'main plus rail',
    label: 'Main plus rail',
    rule: 'From laptop width a narrow column on the right holds what you glance at: counts, what is running, what Dash did, what is due soon. The column you work in sits on the left at its reading width. On a phone the rail follows the main column, and each is drawn once. The rail never holds the thing you came to act on, and never sits on a detail page, which stays one column.',
    component: 'components/patterns/main-rail.tsx',
  },
  {
    name: 'tabbed sections',
    label: 'Tabbed sections',
    rule: 'The tabs sit under the page header, in one column, and only the open tab is drawn. Each tab is a link that puts it in the address, so a reload, the back button and a pasted link return to it, and old links and anchors land on the tab that holds them. A tab with something waiting in it carries the count. The row stays on one line, scrolling sideways on a phone with every tab a full press target. Folds may sit inside a tab.',
    component: 'components/patterns/tabbed-sections.tsx',
  },
];

/**
 * What a step's text says about its pattern: the name on its "Pattern:" line,
 * lower case and without a trailing full stop, or null when there is no such
 * line. The first such line wins.
 */
export function patternNamed(text: string): string | null {
  const match = text.match(/^\s*(?:[-*]\s*)?\**pattern\**\s*:\**\s*(.+)$/im);
  if (!match) return null;
  const name = match[1]
    .trim()
    .replace(/[*_`"]/g, '')
    .replace(/\.$/, '')
    .trim()
    .toLowerCase();
  return name || null;
}

/** The pattern of that name, or null for a name that is not one of them. */
export function patternRule(name: string): PatternRule | null {
  const wanted = name.trim().toLowerCase();
  return PATTERN_RULES.find((p) => p.name === wanted) ?? null;
}

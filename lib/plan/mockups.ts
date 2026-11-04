/** The private bucket holding the pictures kept with questions (plan #2810, migration 0290). */
export const PLAN_MOCKUPS_BUCKET = 'plan-mockups';

/** The two widths every mockup is photographed at: a phone and a laptop. */
export const MOCKUP_WIDTHS = [390, 1280] as const;
export type MockupWidth = (typeof MOCKUP_WIDTHS)[number];

/** Where a picture sits in the bucket: `<user id>/<plan item number>/<file>.png`. */
export function mockupStoragePath(
  userId: string,
  number: number,
  optionLetter: string | null,
  width: MockupWidth,
): string {
  return `${userId}/${number}/${optionLetter ?? 'whole'}-${width}.png`;
}

/**
 * Words that make a question one about a screen. A decision whose title or
 * detail uses one is asking the person to picture something, so it comes with
 * a mockup (plan #2810.3). A short list of plain words: a miss costs a
 * question without a picture, a false hit costs one `--no-mockup`.
 */
const SCREEN_WORDS =
  /\b(layouts?|screens?|pages?|panels?|panes?|columns?|tabs?|pattern|gallery|mockups?|wireframes?|sidebars?|modal|drawer|cards?|dashboard|ui)\b/i;

/**
 * Why `add` turns a decision away, or null when it may go in. A decision about
 * a screen needs `--mockup <html file>`; one that is not about a screen says
 * so with `--no-mockup "why"`.
 */
export function mockupRefusal(input: {
  kind: string;
  title: string;
  detail: string | null;
  mockup: string | null;
  noMockupReason: string | null;
}): string | null {
  if (input.kind !== 'decision') return null;
  if (input.mockup) return null;
  if (input.noMockupReason?.trim()) return null;
  if (!SCREEN_WORDS.test(`${input.title}\n${input.detail ?? ''}`)) return null;
  return (
    'This question is about a screen, so it needs a picture of each option. Draw the options in one HTML file, ' +
    'mark each with data-option="A", "B" and so on, and add --mockup <file.html> [--link <published page>]. ' +
    'If it is not about how something looks, add --no-mockup "<why not>".'
  );
}

/** The letters a mockup file marks with data-option, in order, deduplicated. */
export function optionLettersIn(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/data-option\s*=\s*["']([A-Z])["']/g)) {
    if (!found.includes(match[1])) found.push(match[1]);
  }
  return found;
}

/**
 * The question a screen held for the person becomes (plan #2966.4).
 *
 * On 5 November 2026 the person agreed that a screen still differing from its
 * mockup, failing its done-when or worse than it was after three design
 * review rounds comes to them, with the shot beside the mockup, instead of the
 * builder settling it. `npm run ui-guard -- <n> --ask` writes one of these per
 * held surface: an HTML file whose two options `plan.ts add --kind decision
 * --mockup` photographs, and the title and detail of the decision. Their rule
 * of 12 October 2026, that design checks are not put to them, still holds for
 * every other kind of fix, which the builder settles as before.
 *
 * No side effects: the caller reads the rounds and the shots and writes the
 * file.
 */
import { heldBreaks, heldKindsText } from './ui-check-guard';
import type { StopFix } from './ui-check-stop';

export type PersonAsk = {
  surface: string;
  /** The page the surface stands for, such as `/dev/ui`, or null when it has none. */
  route: string | null;
  /** The round that still cites them. */
  round: number;
  /** The kinds it cites, from `PERSON_HELD_BREAKS`. */
  kinds: readonly string[];
  /** That round's fixes; only the held kinds are put to the person. */
  fixes: readonly StopFix[];
  /** Where the page finds the latest shot, the reference picture and main's shot. */
  shot: string;
  reference: string | null;
  before: string | null;
};

/** The fixes of the round that only the person settles. */
export function heldFixes(fixes: readonly StopFix[]): StopFix[] {
  return fixes.filter((fix) => heldBreaks([fix]).length > 0);
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** What option B is, by what the held fixes cite and what there is to show. */
function changeOption(ask: PersonAsk): { name: string; picture: string | null; caption: string } {
  if (ask.kinds.includes('reference') && ask.reference) {
    return { name: 'Change it to match the mockup', picture: ask.reference, caption: 'The mockup' };
  }
  if (ask.kinds.includes('regression') && ask.before) {
    return { name: 'Put back what it lost', picture: ask.before, caption: 'The same screen on main today' };
  }
  return { name: 'Change it to do what the step says', picture: null, caption: 'What the review found' };
}

/** How the page is named to the person: its route and the gallery link that opens the drawing. */
function pageName(ask: PersonAsk): string {
  return `${ask.route ?? ask.surface} (/preview?s=${ask.surface})`;
}

/**
 * The mockup file: option A is the screen as built, option B what the fixes
 * would make it, each a `data-option` element the mockup shooter photographs
 * at 390 and 1280.
 */
export function personAskHtml(ask: PersonAsk): string {
  const change = changeOption(ask);
  const fixes = heldFixes(ask.fixes);
  const list = fixes
    .map((f) => `<li>${escape(f.problem)}${f.where ? ` <span class="muted">(${escape(f.where)})</span>` : ''}</li>`)
    .join('');
  const picture = (src: string, alt: string) => `<img src="${escape(src)}" alt="${escape(alt)}">`;
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escape(ask.surface)} after round ${ask.round}</title>`,
    '<style>',
    'body { margin: 0; padding: 16px; background: #fff; color: #111; font: 15px/1.5 system-ui, sans-serif; }',
    '.options { display: grid; gap: 16px; grid-template-columns: 1fr; }',
    '@media (min-width: 900px) { .options { grid-template-columns: 1fr 1fr; } }',
    'figure { margin: 0; padding: 12px; border: 1px solid #d4d4d8; border-radius: 8px; }',
    'figcaption { font-weight: 600; margin-bottom: 8px; }',
    'img { display: block; width: 100%; height: auto; border: 1px solid #e4e4e7; }',
    'ul { margin: 8px 0 0; padding-left: 20px; }',
    '.muted { color: #52525b; }',
    '</style></head><body>',
    '<div class="options">',
    `<figure data-option="A"><figcaption>A. Keep it as built</figcaption>${picture(ask.shot, `${ask.surface} as built`)}</figure>`,
    `<figure data-option="B"><figcaption>B. ${escape(change.name)}</figcaption>`,
    change.picture ? picture(change.picture, change.caption) : '',
    `<p class="muted">What the review asks for:</p><ul>${list}</ul></figure>`,
    '</div>',
    '</body></html>',
  ].join('\n');
}

/** The decision's title and detail, for `plan.ts add "<title>" --kind decision --detail "<detail>"`. */
export function personAskQuestion(ask: PersonAsk): { title: string; detail: string } {
  const change = changeOption(ask);
  const fixes = heldFixes(ask.fixes);
  const page = ask.route ?? ask.surface;
  const title = `Keep ${page} as built, or ${change.name.charAt(0).toLowerCase()}${change.name.slice(1)}?`;
  const found = fixes.map((f) => `${f.problem}${f.change ? ` The change: ${f.change}` : ''}`).join(' ');
  const detail = [
    `After ${ask.round} rounds the design review still says ${pageName(ask)} departs from ` +
      `${heldKindsText(ask.kinds)}. ${found}`.trim(),
    'A — Keep it as built. It goes to main as the first picture shows, and these fixes are dropped.',
    `B — ${change.name}. The builder makes the changes above and the screen is reviewed again.`,
    'Recommend B: it is what the step set out to build.',
  ].join('\n');
  return { title, detail };
}

/** The shell argument for a value, in single quotes. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * A Learn now card as the page shows it (LEARN-NOW-SPEC "A card"; plan #808).
 *
 * The row in `learn.feed_cards` holds the summary and the why line; the
 * catalogue holds the article and the section's text. This turns the joined
 * row into what the page renders, and holds the rules the page and its actions
 * share: how much of the section shows before "Read the rest", which licence
 * and link the source line carries, and which status each action may move a
 * card from. No database here, so all of it is tested directly.
 */

export type FeedCardRow = {
  id: string;
  reason: 'interest' | 'gap' | 'queued';
  status: string;
  summary: string | null;
  why: string | null;
  item: { title: string; canonical_url: string; licence: string | null } | null;
  segment: { heading: string | null; text: string; section_anchor: string | null } | null;
};

export type FeedCard = {
  id: string;
  reason: 'interest' | 'gap';
  /** "Article: Section", or the article alone for its lead. */
  title: string;
  article: string;
  section: string | null;
  why: string;
  summary: string;
  /** The paragraphs shown before "Read the rest". */
  shown: string[];
  /** The paragraphs behind it. Empty when the section is short enough to show whole. */
  rest: string[];
  /** Minutes the rest takes to read, rounded up. Zero when there is no rest. */
  restMinutes: number;
  /** The section on the source's own page. */
  link: string;
  /** Where the link goes, named: "Wikipedia", or the host for anything else. */
  site: string;
  licence: string | null;
};

/** Characters shown before the fold: about a phone screen of text. */
export const SHOWN_CHARS = 700;

/** Reading speed for the "min" on Read the rest. */
const WORDS_PER_MINUTE = 230;

/** "Inflation: Causes", or "Inflation" for the lead, which has no heading. */
export function cardTitle(article: string, section: string | null): string {
  return section ? `${article}: ${section}` : article;
}

/**
 * The link to the section itself. The lead has no anchor and links to the
 * article, which opens on the lead.
 */
export function sectionLink(url: string, anchor: string | null): string {
  const base = url.split('#')[0]!;
  return anchor ? `${base}#${anchor}` : base;
}

/**
 * The licence the source line names. The catalogue's own column when it has
 * one; Wikipedia's text is CC BY-SA, which the sweep does not write down, so
 * it is read from the host. Anything else with no licence stored names none.
 */
export function licenceFor(licence: string | null, url: string): string | null {
  if (licence && licence.trim()) return licence.trim();
  try {
    return new URL(url).hostname.endsWith('wikipedia.org') ? 'CC BY-SA 4.0' : null;
  } catch {
    return null;
  }
}

/** The site a source is on, as the source line names it. */
export function siteName(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.endsWith('wikipedia.org') ? 'Wikipedia' : host.replace(/^www\./, '');
  } catch {
    return 'the source';
  }
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Split a section into what shows and what folds.
 *
 * Whole paragraphs are shown until the next one would pass `limit`. A first
 * paragraph longer than that on its own is cut at the last sentence end
 * before the limit, and the rest of it goes behind the fold. A section whose
 * fold would hide less than a fifth of the limit is shown whole: a "Read the
 * rest" that opens one line is a button for nothing.
 */
export function splitForReading(
  text: string,
  limit: number = SHOWN_CHARS,
): { shown: string[]; rest: string[]; restMinutes: number } {
  const paragraphs = text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return { shown: [], rest: [], restMinutes: 0 };

  const total = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
  if (total <= limit * 1.2) return { shown: paragraphs, rest: [], restMinutes: 0 };

  const shown: string[] = [];
  let used = 0;
  let index = 0;
  while (index < paragraphs.length && used + paragraphs[index]!.length <= limit) {
    used += paragraphs[index]!.length;
    shown.push(paragraphs[index]!);
    index += 1;
  }

  const rest = paragraphs.slice(index);
  if (shown.length === 0) {
    const first = rest.shift()!;
    const cut = sentenceCut(first, limit);
    shown.push(first.slice(0, cut).trim());
    const remainder = first.slice(cut).trim();
    if (remainder) rest.unshift(remainder);
  }

  const restWords = rest.reduce((sum, paragraph) => sum + words(paragraph), 0);
  return { shown, rest, restMinutes: rest.length ? Math.max(1, Math.ceil(restWords / WORDS_PER_MINUTE)) : 0 };
}

/** Where to cut one long paragraph: after the last sentence end before the limit. */
function sentenceCut(paragraph: string, limit: number): number {
  const window = paragraph.slice(0, limit);
  let cut = -1;
  for (const match of window.matchAll(/[.!?]["')\]]?\s/g)) cut = match.index + match[0].length;
  if (cut > limit / 3) return cut;
  // No sentence end in reach: cut at the last space rather than mid-word.
  const space = window.lastIndexOf(' ');
  return space > 0 ? space : limit;
}

/**
 * The page's card, or null for a row it cannot show: a queued reading, which
 * is shown from the reading itself, or a row missing its summary, why line or
 * catalogue text.
 */
export function toFeedCard(row: FeedCardRow): FeedCard | null {
  if (row.reason === 'queued') return null;
  if (!row.item || !row.segment || !row.summary || !row.why) return null;
  const { shown, rest, restMinutes } = splitForReading(row.segment.text);
  return {
    id: row.id,
    reason: row.reason,
    title: cardTitle(row.item.title, row.segment.heading),
    article: row.item.title,
    section: row.segment.heading,
    why: row.why,
    summary: row.summary,
    shown,
    rest,
    restMinutes,
    link: sectionLink(row.item.canonical_url, row.segment.section_anchor),
    site: siteName(row.item.canonical_url),
    licence: licenceFor(row.item.licence, row.item.canonical_url),
  };
}

/** The actions a card records (LEARN-NOW-SPEC "What is recorded"). */
export type FeedAction = 'opened' | 'saved' | 'dismissed' | 'tested' | 'passed';

/**
 * The statuses each action may move a card from.
 *
 * Opening the source only marks a card nobody has decided on: opening a card
 * you already saved leaves it saved. Save, Not interested and Test me may
 * follow an open, since reading the source is often how you decide to save it
 * or to be tested on it. Test me may also follow a Save, and the card keeps
 * `saved_reading_id`, so both are still readable. Otherwise nothing moves a
 * card that was saved, dismissed or tested: the first decision stands.
 *
 * Next marks a card `passed`, only from `ready`. A pass takes the card out of
 * the feed and says nothing about what you thought of it, so every other
 * action may still follow it: the card stays on the screen for the rest of the
 * visit, and scrolling back up to save it should work.
 */
export const ACTION_FROM: Record<FeedAction, readonly string[]> = {
  opened: ['ready', 'passed'],
  saved: ['ready', 'opened', 'passed'],
  dismissed: ['ready', 'opened', 'passed'],
  tested: ['ready', 'opened', 'saved', 'passed'],
  passed: ['ready'],
};

/** Append a page of cards, skipping any already on the screen. */
export function appendCards(current: FeedCard[], incoming: FeedCard[]): FeedCard[] {
  const seen = new Set(current.map((card) => card.id));
  return [...current, ...incoming.filter((card) => !seen.has(card.id))];
}

/** Cards loaded at a time: the first screen, and each time the last comes into view. */
export const FEED_PAGE = 5;

/**
 * What the foot of the feed says once a page came back short.
 *
 * `writing`: fewer than `low` cards are ready, so the top-up is running (the
 * action that loaded the page started it) and more will arrive.
 * `passed`: plenty are ready but all of them are already on the screen this
 * visit. The ones you have not scrolled past or pressed Next on are still
 * ready, and they come back next time.
 */
export function feedEnd(ready: number, low: number): 'writing' | 'passed' {
  return ready < low ? 'writing' : 'passed';
}

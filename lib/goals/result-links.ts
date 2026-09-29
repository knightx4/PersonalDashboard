/**
 * Links in what Dash wrote on a step.
 *
 * A result names places as bare domains ("Sign up at transalt.org/volunteer")
 * as often as it writes them as links, and markdown only turns a full
 * https:// address into a link. So the page turns the bare ones into links
 * before it draws the result, and takes the first place a result points to as
 * the link beside its finding on the goal page.
 *
 * Pure, so both are tested without a page.
 */

/** The endings a bare name must have to be read as a site. */
const TLDS = 'org|com|net|gov|edu|io|nyc|us|co|app|dev|info|me|ai|uk|ca';

/**
 * A bare domain with an optional path. Not after a character that would make
 * it part of something else: a word, an address (`@`), or a path or a longer
 * name (`/`, `.`, `-`, `:`). Links already written are split off first.
 */
const BARE = new RegExp(
  `(?<![\\w@/.:\\-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS}))(\\/[^\\s)\\]<>"]*)?(?![\\w@-])`,
  'gi',
);

/** Punctuation that ends a sentence rather than the address it follows. */
const TRAILING = /[.,;:!?'"’”]+$/;

/** Markdown links, bare https addresses and code, left as they are. */
const KEEP = /(`[^`]*`|\[[^\]]*\]\([^)]*\)|<https?:\/\/[^>]+>|https?:\/\/[^\s)<>]+)/gi;

/**
 * The result with each bare domain written as a link: `transalt.org/volunteer`
 * becomes `[transalt.org/volunteer](https://transalt.org/volunteer)`. Links
 * already written, full addresses, email addresses and code are left alone.
 */
export function linkBareDomains(markdown: string): string {
  return markdown
    .split(KEEP)
    .map((part, index) => {
      // split with one group puts the kept pieces at the odd indexes.
      if (index % 2 === 1) return part;
      return part.replace(BARE, (match: string) => {
        const tail = TRAILING.exec(match)?.[0] ?? '';
        const place = tail ? match.slice(0, -tail.length) : match;
        return `[${place}](https://${place})${tail}`;
      });
    })
    .join('');
}

/**
 * The first place a result points to, as a full address: a markdown link's
 * target, an https address, or a bare domain. Null when it names none. An
 * email address is not a place to open, so it is skipped.
 */
export function firstLink(markdown: string): string | null {
  const linked = linkBareDomains(markdown);
  const match = /\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>]+)>|(https?:\/\/[^\s)<>]+)/i.exec(linked);
  if (!match) return null;
  return (match[1] ?? match[2] ?? match[3]).replace(TRAILING, '');
}

/**
 * A markdown link, or a full address. Bare domains are written as markdown
 * links by `linkBareDomains` first, so this is all there is left to find.
 */
const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s)<>\]]+)/gi;

export type TextPart = { text: string } | { text: string; href: string };

/**
 * Plain text split into what is written and what is a link: markdown links,
 * full addresses and bare domains such as ikea.com/us. Pure, for the tests.
 */
export function linkParts(text: string): TextPart[] {
  const source = linkBareDomains(text);
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of source.matchAll(LINK)) {
    const [whole, label, target, angled, bare] = match;
    let href = target ?? angled ?? bare;
    let shown = label ?? href;
    let used = whole;
    if (bare) {
      const tail = TRAILING.exec(bare)?.[0] ?? '';
      href = tail ? bare.slice(0, -tail.length) : bare;
      shown = href;
      used = href;
    }
    if (match.index > last) parts.push({ text: source.slice(last, match.index) });
    parts.push({ text: shown, href });
    last = match.index + used.length;
  }
  if (last < source.length) parts.push({ text: source.slice(last) });
  return parts;
}

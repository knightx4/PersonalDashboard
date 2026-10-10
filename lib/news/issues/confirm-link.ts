/**
 * The link a signup email asks you to press to confirm the subscription
 * (plan #1723, under #1722 "Confirm a newsletter signup with one button").
 *
 * When an issue is digested as a confirmation (ISSUE_PURPOSES in digest.ts),
 * this picks its confirmation link out of the body, and digestIssue stores it
 * as news.issues.confirm_url. The issue page and the newsletter list show a
 * Confirm button for it that opens the link in a new tab when pressed. The
 * app never visits the link itself.
 *
 * A link is a candidate when its words or its address say confirm, verify,
 * activate, subscribe or opt in, and nothing about it says unsubscribe,
 * preferences or the like. Only https links are kept, and a bare site address
 * (no path, no query) is never one, since a button that only opens a home
 * page confirms nothing. Of the candidates, a link whose words say so beats
 * one whose address does, and a link carrying a token beats one without; a
 * tie goes to the first in the email, which is where the button usually is.
 * With no candidate the result is null and no button is shown.
 *
 * The HTML is read first, since its links are what pressing in the email
 * opens. The text body is the fallback, where each address is judged with the
 * words on its own line before it.
 */

/** Words that make a link a confirmation link. */
const STRONG = /\b(confirm|verify|verification|activate|activation)/i;
/** Words that do so only weakly: "Yes, subscribe me", "opt in". */
const WEAK = /\b(subscribe|opt[\s_-]?in)\b/i;
/** Words that rule a link out whatever else it says. */
const NEGATIVE = /unsubscri|opt[\s_-]?out|preferences|manage|cancel|not you|did ?n[o’']t|report|privacy/i;
/** Address words that say confirm, read in the decoded address. */
const ADDRESS_WORDS = /confirm|verif|activat|opt-?in|subscri/i;
/** A token: a long run of letters, digits and the usual URL-safe marks. */
const TOKEN = /[A-Za-z0-9_\-.~%+=]{16,}/;

const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const TEXT_URL = /https?:\/\/[^\s<>[\]()"']+/gi;

/** A link as the email shows it: where it goes and the words on it. */
export type EmailLink = { url: string; text: string };

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/gi, '&');
}

/** Every link in an email's HTML, in order, with its words stripped of tags. */
export function htmlLinks(html: string): EmailLink[] {
  const cleared = html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  const links: EmailLink[] = [];
  for (const match of cleared.matchAll(ANCHOR)) {
    const href = HREF.exec(match[1] ?? '');
    if (!href) continue;
    const url = decodeEntities(href[1] ?? href[2] ?? href[3] ?? '').trim();
    const text = decodeEntities((match[2] ?? '').replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    links.push({ url, text });
  }
  return links;
}

/**
 * Every address written out in a plain-text body, with the words on its line
 * before it as its text: "Confirm subscription (https://…)" reads as a link
 * whose words are "Confirm subscription".
 */
export function textLinks(text: string): EmailLink[] {
  const links: EmailLink[] = [];
  for (const line of text.split(/\r?\n/)) {
    let from = 0;
    for (const match of line.matchAll(TEXT_URL)) {
      const at = match.index ?? 0;
      const words = line
        .slice(from, at)
        .replace(/[[(<:]+\s*$/, '')
        .trim();
      links.push({ url: match[0].replace(/[.,;:!?]+$/, ''), text: words });
      from = at + match[0].length;
    }
  }
  return links;
}

/**
 * The address as a URL when it is written as https and goes somewhere past
 * the home page. The address is stored as the email wrote it, not as URL
 * would rewrite it.
 */
function usable(address: string): URL | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (!/^https:\/\//.test(address) || url.protocol !== 'https:') return null;
  if ((url.pathname === '/' || url.pathname === '') && !url.search) return null;
  return url;
}

function decoded(address: string): string {
  try {
    return decodeURIComponent(address);
  } catch {
    return address;
  }
}

/** How strongly a link reads as the confirmation link; 0 when it is not one. */
export function confirmScore(link: EmailLink): number {
  const url = usable(link.url);
  if (!url) return 0;
  const address = decoded(link.url);
  if (NEGATIVE.test(link.text) || /unsubscri|opt-?out|preferences/i.test(address)) return 0;
  const strong = STRONG.test(link.text);
  const weak = WEAK.test(link.text);
  const inAddress = ADDRESS_WORDS.test(address.slice('https://'.length));
  const token = TOKEN.test(`${url.pathname}${url.search}`);
  // Only the words or the address with a token in it make a link clear enough.
  if (!strong && !weak && !(inAddress && token)) return 0;
  return (strong ? 4 : weak ? 2 : 0) + (inAddress ? 2 : 0) + (token ? 1 : 0);
}

/** The best candidate among links, or null when none is one. */
export function pickConfirmLink(links: readonly EmailLink[]): string | null {
  let best: { url: string; score: number } | null = null;
  for (const link of links) {
    const score = confirmScore(link);
    if (score > 0 && (!best || score > best.score)) best = { url: link.url, score };
  }
  return best?.url ?? null;
}

/**
 * The confirmation link in one email, or null when none is clear. The HTML's
 * links are read first and the text body's only when the HTML yields none.
 */
export function findConfirmLink(source: {
  htmlBody: string | null;
  textBody: string | null;
}): string | null {
  const fromHtml = source.htmlBody ? pickConfirmLink(htmlLinks(source.htmlBody)) : null;
  if (fromHtml) return fromHtml;
  return source.textBody ? pickConfirmLink(textLinks(source.textBody)) : null;
}

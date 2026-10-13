/**
 * What a saved link's page says about itself: its title and who wrote it.
 *
 * Pure, so it can be tested without the network. The order of preference is
 * the page's own Open Graph title, then its <title> with the site's name taken
 * off the end, then the address itself, so a page that tells us nothing still
 * saves as something recognisable.
 */

export type LinkMeta = { title: string; author: string | null };

/** Readings and sources refuse a longer title. */
const TITLE_MAX = 500;

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

function meta(html: string, attr: 'property' | 'name', key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+${attr}\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*"([^"]*)"`, 'i'),
    new RegExp(`<meta[^>]+${attr}\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*'([^']*)'`, 'i'),
    new RegExp(`<meta[^>]+content\\s*=\\s*"([^"]*)"[^>]*${attr}\\s*=\\s*["']${escaped}["']`, 'i'),
    new RegExp(`<meta[^>]+content\\s*=\\s*'([^']*)'[^>]*${attr}\\s*=\\s*["']${escaped}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const found = clean(html.match(pattern)?.[1]);
    if (found) return found;
  }
  return null;
}

/** "You Need a New CFO | Andreessen Horowitz" less the site's name. */
function withoutSite(title: string, site: string | null): string {
  const separator = /\s+[|·•–—-]\s+(?!.*\s+[|·•–—-]\s+)/.exec(title);
  if (!separator) return title;
  const head = title.slice(0, separator.index);
  const tail = title.slice(separator.index + separator[0].length).toLowerCase();
  if (site && tail === site.toLowerCase()) return head;
  // Without a site name to match, only a short tail reads as one.
  if (!site && tail.length <= 30 && head.length > tail.length) return head;
  return title;
}

/** The address as a title: the host and the last part of the path, words spaced. */
export function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const slug = parsed.pathname.split('/').filter(Boolean).pop();
    if (!slug) return host;
    const words = decodeURIComponent(slug)
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[-_+]+/g, ' ')
      .trim();
    if (!words) return host;
    return `${words.charAt(0).toUpperCase()}${words.slice(1)} (${host})`;
  } catch {
    return url;
  }
}

/** The title and author a page gives itself, falling back to its address. */
export function readLinkMeta(html: string, url: string): LinkMeta {
  const site = meta(html, 'property', 'og:site_name');
  const titleTag = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const title =
    meta(html, 'property', 'og:title') ??
    meta(html, 'name', 'twitter:title') ??
    (titleTag ? withoutSite(titleTag, site) : null) ??
    titleFromUrl(url);

  const named = meta(html, 'name', 'author') ?? meta(html, 'property', 'article:author');
  // article:author is often a profile URL, which is no name.
  const author = named && !/^https?:\/\//i.test(named) ? named : site;

  return { title: title.slice(0, TITLE_MAX), author: author ? author.slice(0, 200) : null };
}

/**
 * The first http(s) address in what was shared or pasted. A share sheet puts
 * the link in `url` on some phones and inside `text` on others, often after
 * the page's title, so both are searched.
 */
export function findLink(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const found = value?.match(/https?:\/\/[^\s<>"']+/i)?.[0];
    if (!found) continue;
    // A link at the end of a sentence keeps its full stop otherwise.
    const trimmed = found.replace(/[.,;:!?)\]]+$/, '');
    try {
      return new URL(trimmed).toString();
    } catch {
      continue;
    }
  }
  return null;
}

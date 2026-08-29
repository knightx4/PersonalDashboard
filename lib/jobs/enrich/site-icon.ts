import 'server-only';

import { safeFetch } from '@/lib/jobs/ats/ssrf';

/**
 * A company's logo, taken from the company's own site.
 *
 * Deliberately not a favicon service. Those work by receiving the domain of
 * every company you are interested in, which turns "fill in a logo" into
 * "tell a third party who you are applying to". Reading the site's own markup
 * costs one request that the user's action already implies, and sends the
 * information to the only party that already has it.
 *
 * Goes through the same SSRF guard as the JD fetchers, because this is the
 * same primitive: a server-side request to a host the user supplied.
 */

interface IconCandidate {
  href: string;
  /** Bigger is better, and a declared size beats a guessed one. */
  size: number;
  priority: number;
}

const ICON_REL = /\b(apple-touch-icon(-precomposed)?|icon|shortcut icon|mask-icon)\b/i;

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[2] ?? match[3] ?? match[4] ?? null) : null;
}

function largestDeclaredSize(sizes: string | null): number {
  if (!sizes) return 0;
  let best = 0;
  for (const entry of sizes.split(/\s+/)) {
    const match = entry.match(/^(\d+)x(\d+)$/i);
    if (match) best = Math.max(best, Number(match[1]));
  }
  return best;
}

/** Icon candidates declared in the page head, best first. */
export function iconCandidates(html: string, baseUrl: string): string[] {
  const candidates: IconCandidate[] = [];

  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attribute(tag, 'rel');
    if (!rel || !ICON_REL.test(rel)) continue;
    const href = attribute(tag, 'href');
    if (!href) continue;

    const declared = largestDeclaredSize(attribute(tag, 'sizes'));
    candidates.push({
      href,
      size: declared,
      // An apple-touch-icon is a real logo at a usable size; a favicon is
      // frequently a 16px glyph that looks like dirt on the page.
      priority: /apple-touch-icon/i.test(rel) ? 3 : declared >= 64 ? 2 : 1,
    });
  }

  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const property = attribute(tag, 'property') ?? attribute(tag, 'name');
    if (!property || !/^(og:image(:url)?|twitter:image)$/i.test(property)) continue;
    const content = attribute(tag, 'content');
    // An og:image is a share card as often as a logo, so it ranks below a
    // declared icon and above nothing at all.
    if (content) candidates.push({ href: content, size: 0, priority: 0 });
  }

  const seen = new Set<string>();
  return candidates
    .sort((a, b) => b.priority - a.priority || b.size - a.size)
    .map((candidate) => {
      try {
        const url = new URL(candidate.href, baseUrl);
        // An inline data: favicon would go straight into logo_url and bloat
        // the row; javascript: has no business being there at all.
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        return url.toString();
      } catch {
        return null;
      }
    })
    .filter((url): url is string => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

/**
 * Best icon for a domain, or null.
 *
 * Never throws: this is the cosmetic half of enrichment, and a company site
 * that refuses us should cost a logo rather than the whole lookup.
 */
export async function fetchSiteIcon(domain: string): Promise<string | null> {
  const base = `https://${domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;

  try {
    const { status, body, url } = await safeFetch(base);
    if (status !== 200) return null;
    const [best] = iconCandidates(body, url);
    return best ?? `${base}/favicon.ico`;
  } catch {
    return null;
  }
}

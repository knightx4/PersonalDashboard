/**
 * Which image to show for a company, and what to show when there is none.
 *
 * Pure and client-safe: the board renders one of these per card, so the
 * decision has to be makeable during render without a round trip.
 *
 * Deliberately not shared with `lib/merchants/avatar`. A merchant's domains
 * come from the mail that announced an order; a company's come from whatever
 * careers URL created it, which means they are full of ATS hosts — a card for
 * Acme whose only domain is `boards.greenhouse.io` must not show Greenhouse's
 * icon and claim it is Acme's. That rule is the whole difference, and folding
 * the two together would mean one of them carrying the other's exceptions.
 */

import { detectPosting } from '@/lib/jobs/ats/detect';

export interface CompanyAvatarSource {
  name: string;
  logoUrl?: string | null;
  domains?: readonly string[] | null;
  website?: string | null;
  careersUrl?: string | null;
}

/**
 * Whether a host is the company's own rather than the ATS it happens to
 * recruit through. `detectPosting` already knows every vendor host the app
 * fetches from, so this asks it rather than keeping a second list that would
 * drift out of step with the first.
 */
export function isOwnDomain(domain: string): boolean {
  const host = normaliseHost(domain);
  if (!host || !host.includes('.')) return false;
  const { vendor } = detectPosting(`https://${host}`);
  return vendor === 'other';
}

function normaliseHost(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/**
 * The company's own domain, best first.
 *
 * `website` outranks the domains array because it is the one field that was
 * either typed or confirmed by a lookup, where the array is an accumulation of
 * everything any email or URL ever suggested. `careers_url` comes last: it is
 * the field most likely to be an ATS, and by the time we reach it the ATS
 * hosts have been dropped anyway, so what survives is a real careers subdomain
 * like `jobs.ramp.com` — which serves an icon perfectly well.
 */
export function companyDomain(source: CompanyAvatarSource): string | null {
  const candidates = [
    normaliseHost(source.website),
    ...(source.domains ?? []).map(normaliseHost),
    normaliseHost(source.careersUrl),
  ];

  for (const host of candidates) {
    if (host && isOwnDomain(host)) return host;
  }
  return null;
}

/**
 * A favicon for a domain, from Google's public endpoint. No key, no quota
 * worth worrying about, and it is what the shopping side already uses.
 *
 * The cost is real and worth stating: the request carries the domain, so
 * Google learns which companies this account looks at. That is the trade
 * `USE_FAVICON_SERVICE` names — set it to false and every company falls back
 * to whatever `logo_url` enrichment stored, then to initials.
 */
export function faviconUrl(domain: string, size = 128): string {
  const host = normaliseHost(domain) ?? domain;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
}

/**
 * Whether to fall back to the favicon service when a company has no stored
 * logo. Enrichment only runs when you press the button on a company page, so
 * with this off almost every card shows initials.
 */
export const USE_FAVICON_SERVICE = true;

/** The image to render, or null when initials are the answer. */
export function companyAvatarSrc(
  source: CompanyAvatarSource,
  { favicons = USE_FAVICON_SERVICE }: { favicons?: boolean } = {},
): string | null {
  const stored = source.logoUrl?.trim();
  if (stored) return stored;
  if (!favicons) return null;
  const domain = companyDomain(source);
  return domain ? faviconUrl(domain) : null;
}

/** Two letters, so a card without an image still has something to aim at. */
export function companyInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
}

/**
 * The employer a careers page names, for a link pasted with no company.
 *
 * Pure: it reads HTML and a URL and fetches nothing. The sources run from the
 * most certain to the least, and the first that yields a name wins:
 *
 *   1. schema.org JobPosting hiringOrganization
 *   2. the og:site_name meta tag
 *   3. the page title ("Role | Company", "Role at Company")
 *   4. the domain (jobs.ubs.com gives UBS), only when the caller says the host
 *      is the employer's own and not a board or aggregator
 *
 * A page that offers none of them gives null, and Dash asks.
 */

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Words that describe a careers site rather than name an employer. */
const GENERIC =
  /^(careers?|jobs?|job (search|board|openings?|listings?|details?)|career (site|opportunities|center|centre|portal)|search jobs|vacancies|opportunities|apply|home|work with us|join us|join our team|current openings|open positions|talent|recruiting|recruitment)$/i;

const SUFFIX =
  /\s*[-–—:|·]?\s*\b(careers?|jobs?|career (site|opportunities|center|centre|portal)|job (search|board|openings?)|vacancies|recruiting|recruitment)\s*$/i;

const MAX_NAME = 80;

/** A name as the page wrote it, minus a trailing "Careers", or null when nothing is left. */
export function cleanCompanyName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  if (GENERIC.test(name)) return null;
  const stripped = name.replace(SUFFIX, '').trim();
  if (stripped) name = stripped;
  name = name.replace(/^[-–—:|·\s]+|[-–—:|·\s]+$/g, '');
  if (!name || name.length > MAX_NAME || GENERIC.test(name)) return null;
  return name;
}

function nameOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return nameOf(value[0]);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return nameOf(record.name) ?? nameOf(record.legalName);
  }
  return null;
}

/** The hiringOrganization of a parsed JobPosting node: a name, an Organization object, or a list of them. */
export function companyFromJobPosting(posting: { hiringOrganization?: unknown } | null | undefined): string | null {
  return cleanCompanyName(nameOf(posting?.hiringOrganization));
}

function metaContent(html: string, key: string, value: string): string | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const text = tag[0];
    if (!new RegExp(`\\b${key}\\s*=\\s*["']${value}["']`, 'i').test(text)) continue;
    const content = text.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const found = content?.[1] ?? content?.[2];
    if (found) return decodeEntities(found).trim();
  }
  return null;
}

export function pageTitle(html: string): string | null {
  const og = metaContent(html, 'property', 'og:title');
  if (og) return og;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title ? decodeEntities(title[1]).replace(/\s+/g, ' ').trim() || null : null;
}

const SEPARATOR = /\s+[|\-–—·•]\s+|\s*::\s*/;

function segments(title: string): string[] {
  return title
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The company a title names. With the role title known, "Data Analyst | UBS"
 * gives UBS whichever side it sits on; without it the last segment is the
 * guess, which is where sites put the brand.
 */
export function companyFromTitle(title: string | null, role?: string | null): string | null {
  if (!title) return null;
  const roleKey = role?.trim().toLowerCase();
  const parts = segments(title);
  if (parts.length < 2) {
    const at = title.match(/^.{3,}?\s+(?:at|@)\s+(.{2,})$/i);
    return at ? cleanCompanyName(at[1]) : null;
  }
  const candidates = roleKey ? parts.filter((part) => part.toLowerCase() !== roleKey) : parts.slice(1).reverse();
  for (const part of candidates) {
    const withAt = part.match(/^.{3,}?\s+at\s+(.{2,})$/i);
    const name = cleanCompanyName(withAt ? withAt[1] : part);
    if (name) return name;
  }
  return null;
}

/** The title with the company and any "Careers" segment taken off, so the role reads as the role. */
export function stripCompanyFromTitle(title: string, company: string): string {
  const key = company.toLowerCase();
  const parts = segments(title);
  if (parts.length < 2) return title;
  const kept = parts.filter((part) => {
    const lower = part.toLowerCase();
    return !(lower === key || GENERIC.test(part) || cleanCompanyName(part)?.toLowerCase() === key);
  });
  return kept.length ? kept.join(' | ') : title;
}

const SUBDOMAINS = new Set(['www', 'jobs', 'job', 'careers', 'career', 'apply', 'work', 'recruiting', 'talent', 'join']);
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac']);

/** jobs.ubs.com gives UBS, careers.bbc.co.uk gives BBC, join.monzo.com gives Monzo. A guess, so the last resort. */
export function companyFromHost(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;
  let end = labels.length - 1;
  if (labels.length >= 3 && labels[end].length === 2 && SECOND_LEVEL.has(labels[end - 1])) end -= 1;
  const brand = labels[end - 1];
  if (!brand || SUBDOMAINS.has(brand) || !/^[a-z0-9-]+$/.test(brand)) return null;
  const words = brand.split('-').filter(Boolean);
  if (words.length === 1 && words[0].length <= 4 && !/\d/.test(words[0])) return words[0].toUpperCase();
  return words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

export type CompanySource = 'jobposting' | 'site_name' | 'title' | 'domain';

/** The company a page names, and which source it came from; null when the page names none. */
export function companyFromPage(input: {
  html: string;
  url: string;
  /** The JobPosting node, when the page has one. */
  posting?: { hiringOrganization?: unknown } | null;
  /** The role title, to tell it from the brand in a "Role | Company" title. */
  role?: string | null;
  /** Whether the host belongs to the employer, so its domain may stand in for a name. */
  ownHost: boolean;
}): { name: string; source: CompanySource } | null {
  const fromPosting = companyFromJobPosting(input.posting);
  if (fromPosting) return { name: fromPosting, source: 'jobposting' };
  const siteName = cleanCompanyName(
    metaContent(input.html, 'property', 'og:site_name') ?? metaContent(input.html, 'name', 'application-name'),
  );
  if (siteName) return { name: siteName, source: 'site_name' };
  const fromTitle = companyFromTitle(pageTitle(input.html), input.role);
  if (fromTitle) return { name: fromTitle, source: 'title' };
  if (input.ownHost) {
    const fromHost = companyFromHost(input.url);
    if (fromHost) return { name: fromHost, source: 'domain' };
  }
  return null;
}

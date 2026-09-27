/**
 * Reading what the suggestion calls report, before anything is stored.
 *
 * The model is told the rules; these check them. A person must not be someone
 * already suggested or already a contact, and a posting must carry a link that
 * is a web address and not one already suggested or applied for. Text is
 * trimmed to the column limits and has the person's banned constructions taken
 * out where that can be done without rewriting (the em dash, above all).
 */
export const MAX_OUTREACH = 3;
export const MAX_OPENINGS = 5;

export const CHANNELS = ['linkedin_dm', 'linkedin_connect', 'email', 'intro', 'event', 'other'] as const;
export type Channel = (typeof CHANNELS)[number];

export type PersonSuggestion = {
  /** Null for an event or a group rather than one person. */
  personName: string | null;
  personTitle: string | null;
  company: string | null;
  /** Where the person was found. */
  sourceUrl: string | null;
  /** A LinkedIn people search that finds them or people like them. */
  searchQuery: string | null;
  headline: string;
  why: string;
  move: string;
  channel: Channel;
  message: string;
};

export type OpeningSuggestion = {
  company: string;
  title: string;
  url: string;
  location: string | null;
  why: string;
  move: string;
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

/**
 * Takes out what the person asked never to see, where it can go without a
 * rewrite: an em dash becomes a comma, or a hyphen between numbers. Phrases
 * are left, since cutting one out of a sentence would break it; the prompt
 * lists them so they are rarely there.
 */
export function cleanText(value: string): string {
  return value
    .replace(/(\d)\s*—\s*(\d)/g, '$1-$2')
    .replace(/\s*—\s*/g, ', ')
    .replace(/,\s*,/g, ',');
}

function clean(value: unknown, max: number): string | null {
  const read = text(value, max);
  return read === null ? null : cleanText(read);
}

/** A company and title reduced to what two spellings of the same role share. */
export function roleKey(company: string, title: string): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(inc|llc|ltd|corp|co)\b\.?/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return `${norm(company)}|${norm(title)}`;
}

/** A person reduced to what two spellings of the same name share. */
export function personKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function webAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function parsePeoplePayload(raw: unknown, taken: { people: ReadonlySet<string> }): PersonSuggestion[] {
  const list = listIn(raw, 'suggestions');
  const people = new Set(taken.people);
  const out: PersonSuggestion[] = [];

  for (const entry of list) {
    if (out.length >= MAX_OUTREACH) break;
    const item = entry as Record<string, unknown>;
    const headline = clean(item.headline, 300);
    const why = clean(item.why, 1000);
    const move = clean(item.move, 1500);
    const message = clean(item.message, 4000);
    if (!headline || !why || !move || !message) continue;
    const personName = clean(item.person_name, 200);
    if (personName) {
      const key = personKey(personName);
      if (people.has(key)) continue;
      people.add(key);
    }
    const channel = CHANNELS.includes(item.channel as Channel) ? (item.channel as Channel) : 'other';
    out.push({
      personName,
      personTitle: clean(item.person_title, 300),
      company: clean(item.company, 200),
      sourceUrl: webAddress(item.source_url),
      searchQuery: clean(item.search_query, 300),
      headline,
      why,
      move,
      channel,
      message,
    });
  }
  return out;
}

/** The LinkedIn people search for a query. */
export function linkedinSearchUrl(query: string): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
}

export function parseOpeningsPayload(
  raw: unknown,
  taken: { urls: ReadonlySet<string>; roles: ReadonlySet<string> },
): OpeningSuggestion[] {
  const list = listIn(raw, 'openings');
  const urls = new Set(taken.urls);
  const roles = new Set(taken.roles);
  const out: OpeningSuggestion[] = [];

  for (const entry of list) {
    if (out.length >= MAX_OPENINGS) break;
    const item = entry as Record<string, unknown>;
    const company = clean(item.company, 200);
    const title = clean(item.title, 250);
    const url = webAddress(item.url);
    const why = clean(item.why, 1000);
    const move = clean(item.move, 1500);
    if (!company || !title || !url || !why || !move) continue;
    const key = roleKey(company, title);
    if (urls.has(url) || roles.has(key)) continue;
    urls.add(url);
    roles.add(key);
    out.push({ company, title, url, location: clean(item.location, 200), why, move });
  }
  return out;
}

/**
 * The list under `key` in a report.
 *
 * Models sometimes hand a long nested array back as a JSON string rather than
 * an array, and the first live runs of both searches were billed and stored
 * nothing, with no error, which is what that looks like from here. So a string
 * that parses to an array is read as one.
 */
export function listIn(raw: unknown, key: string): unknown[] {
  const value = (raw as Record<string, unknown> | null)?.[key];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [];
}

/** An email message split into its subject line and body, as the prompt asks it written. */
export function splitSubject(message: string): { subject: string | null; body: string } {
  const match = /^subject:\s*(.+)\n+/i.exec(message);
  if (!match) return { subject: null, body: message };
  return { subject: match[1].trim(), body: message.slice(match[0].length).trim() };
}

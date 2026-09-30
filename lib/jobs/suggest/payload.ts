/**
 * Reading what the suggestion calls report, before anything is stored.
 *
 * The model is told the rules; these check them. A person must not be someone
 * already suggested or already a contact, and a posting must carry a link that
 * is a web address and not one already suggested or applied for. Text is
 * trimmed to the column limits and has the person's banned constructions taken
 * out where that can be done without rewriting (the em dash, above all). A
 * suggestion in an industry the person excluded is dropped, whatever the model
 * made of the rule, and so is a posting at a company they turned down for
 * being that company.
 */
export const MAX_OUTREACH = 3;
export const MAX_OPENINGS = 8;

export const CHANNELS = [
  'linkedin_dm',
  'linkedin_connect',
  'email',
  'intro',
  'event',
  'other',
] as const;
export type Channel = (typeof CHANNELS)[number];

export type PersonSuggestion = {
  /** Null for an event or a group rather than one person. */
  personName: string | null;
  personTitle: string | null;
  company: string | null;
  industry: string | null;
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
  industry: string | null;
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

/** A company name reduced to what two spellings of it share. */
export function companyKey(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|technologies|labs|hq)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Short forms written out, so "Sr. FP&A Mgr" and "Senior Financial Planning
 * and Analysis Manager" meet. Applied in order, to lower-cased text.
 */
const TITLE_FORMS: readonly (readonly [RegExp, string])[] = [
  [/\bfinancial planning\s*(?:and|&)\s*analysis\b/g, 'fpa'],
  [/\bfp\s*&\s*a\b/g, 'fpa'],
  [/\bbiz\s*ops\b/g, 'business operations'],
  [/\bsr\b\.?/g, 'senior'],
  [/\bjr\b\.?/g, 'junior'],
  [/\bmgr\b\.?/g, 'manager'],
  [/\bassoc\b\.?/g, 'associate'],
  [/\bdir\b\.?/g, 'director'],
  [/\bsvp\b/g, 'senior vice president'],
  [/\bvp\b/g, 'vice president'],
  [/\beng\b\.?/g, 'engineer'],
  [/\bops\b/g, 'operations'],
  [/\bstrat\b\.?/g, 'strategy'],
  [/&/g, ' and '],
];

/**
 * A job title reduced to what two spellings of the same job share: short
 * forms written out, anything in brackets and the workplace words dropped.
 * "Senior Analyst (Remote)" and "Sr. Analyst" are the same job; the level
 * words stay, since "Analyst II" and "Analyst I" are not.
 */
export function titleKey(title: string): string {
  let t = title.toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  for (const [pattern, word] of TITLE_FORMS) t = t.replace(pattern, word);
  return t
    .replace(/\b(remote|hybrid|on ?site|in office)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** A company and title reduced to what two spellings of the same role share. */
export function roleKey(company: string, title: string): string {
  return `${companyKey(company)}|${titleKey(title)}`;
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

/**
 * Other words for an excluded industry, so "crypto" also catches a company the
 * model filed under "digital assets". Only the ones a person is likely to
 * write; anything else matches as written.
 */
const INDUSTRY_WORDS: Record<string, readonly string[]> = {
  crypto: [
    'crypto',
    'cryptocurrency',
    'cryptocurrencies',
    'web3',
    'blockchain',
    'digital asset',
    'defi',
    'bitcoin',
    'ethereum',
    'stablecoin',
    'nft',
    'token',
  ],
  healthcare: [
    'healthcare',
    'health care',
    'health',
    'medical',
    'hospital',
    'pharma',
    'pharmaceutical',
    'biotech',
    'biotechnology',
    'clinical',
    'life sciences',
  ],
  defense: ['defense', 'defence', 'military', 'weapons', 'munitions', 'national security'],
};

/** Every word that marks one of the excluded industries, lower-cased. */
export function exclusionWords(excluded: readonly string[]): string[] {
  const words = new Set<string>();
  for (const raw of excluded) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    words.add(entry);
    const key = Object.keys(INDUSTRY_WORDS).find(
      (name) => entry === name || entry.startsWith(name),
    );
    for (const word of key ? INDUSTRY_WORDS[key] : []) words.add(word);
  }
  return [...words];
}

/** True when any of the texts names an excluded industry as a whole word (or its plural). */
export function isExcluded(words: readonly string[], ...texts: (string | null)[]): boolean {
  if (words.length === 0) return false;
  const haystack = texts.filter(Boolean).join(' ').toLowerCase();
  return words.some((word) =>
    new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(haystack),
  );
}

export function parsePeoplePayload(
  raw: unknown,
  taken: { people: ReadonlySet<string> },
  excluded: readonly string[] = [],
): PersonSuggestion[] {
  const words = exclusionWords(excluded);
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
    const industry = clean(item.industry, 200);
    const company = clean(item.company, 200);
    const personTitle = clean(item.person_title, 300);
    if (isExcluded(words, industry, company, personTitle, headline)) continue;
    const personName = clean(item.person_name, 200);
    if (personName) {
      const key = personKey(personName);
      if (people.has(key)) continue;
      people.add(key);
    }
    const channel = CHANNELS.includes(item.channel as Channel)
      ? (item.channel as Channel)
      : 'other';
    out.push({
      personName,
      personTitle,
      company,
      industry,
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
  taken: { urls: ReadonlySet<string>; roles: ReadonlySet<string>; companies?: ReadonlySet<string> },
  excluded: readonly string[] = [],
): OpeningSuggestion[] {
  const words = exclusionWords(excluded);
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
    const industry = clean(item.industry, 200);
    if (isExcluded(words, industry, company, title)) continue;
    // A company the person turned down once, for being that company.
    if (taken.companies?.has(companyKey(company))) continue;
    const key = roleKey(company, title);
    if (urls.has(url) || roles.has(key)) continue;
    urls.add(url);
    roles.add(key);
    out.push({ company, industry, title, url, location: clean(item.location, 200), why, move });
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

/**
 * Wikidata as a company reference.
 *
 * `companies` has industry, stage, headcount_band, hq_location and logo_url,
 * and until now nothing populated any of them — a company page started empty
 * and stayed empty until you typed it in, which is exactly the moment you are
 * least inclined to. Wikidata is free, keyless, welcomes server traffic, and
 * carries all five for any employer big enough to have a page.
 *
 * The hard part is not fetching, it is being sure this is the right Ramp. A
 * name search alone will confidently hand back a payment company, a ramp
 * manufacturer, and a Belgian village. So the official website is checked
 * against the domains we already hold for the company, and a match on that is
 * what "verified" means here. A name-only hit is still returned, but it is
 * labelled, and nothing is written without the user agreeing to it.
 */
import { getJson } from '@/lib/books/providers/http';

const API_URL = 'https://www.wikidata.org/w/api.php';

/** Wikidata asks API users to identify themselves. */
const USER_AGENT =
  'ShoppingManager/1.0 (personal job search tool; +https://github.com/knightx4/ShoppingManager)';

const PROP_INSTANCE_OF = 'P31';
const PROP_INDUSTRY = 'P452';
const PROP_HEADQUARTERS = 'P159';
const PROP_EMPLOYEES = 'P1128';
const PROP_INCEPTION = 'P571';
const PROP_WEBSITE = 'P856';
const PROP_LOGO = 'P154';
const PROP_LINKEDIN = 'P4264';
const PROP_COUNTRY = 'P17';

/** instance-of values that mean "this is an employer". */
const ORGANISATION_CLASSES = new Set([
  'Q4830453', // business
  'Q891723', // public company
  'Q6881511', // enterprise
  'Q783794', // company
  'Q43229', // organization
  'Q167037', // corporation
  'Q1058914', // software company
  'Q18388277', // technology company
  'Q161726', // multinational corporation
  'Q4830453', // business
  'Q163740', // nonprofit organization
  'Q3918', // university
  'Q31855', // research institute
]);

/** The one instance-of value that is worth reporting as a stage. */
const PUBLIC_COMPANY = 'Q891723';

export interface WikidataCompany {
  wikidataId: string;
  label: string;
  description: string | null;
  /** Bare host, lowercased, no www. */
  websiteDomain: string | null;
  websiteUrl: string | null;
  industry: string | null;
  headquarters: string | null;
  employees: number | null;
  employeesAsOf: number | null;
  foundedYear: number | null;
  isPublicCompany: boolean;
  logoUrl: string | null;
  linkedinUrl: string | null;
}

type Snak = {
  mainsnak?: {
    datavalue?: { value?: unknown };
    qualifiers?: unknown;
  };
  qualifiers?: Record<string, Array<{ datavalue?: { value?: unknown } }>>;
};

type EntitiesResponse = {
  entities?: Record<
    string,
    {
      id?: string;
      labels?: Record<string, { value?: string }>;
      descriptions?: Record<string, { value?: string }>;
      claims?: Record<string, Snak[]>;
    }
  >;
};

type SearchResponse = {
  search?: Array<{ id?: string; label?: string; description?: string }>;
};

function claimValues(claims: Record<string, Snak[]> | undefined, prop: string): unknown[] {
  return (claims?.[prop] ?? []).map((snak) => snak.mainsnak?.datavalue?.value);
}

function claimStrings(claims: Record<string, Snak[]> | undefined, prop: string): string[] {
  return claimValues(claims, prop).filter((value): value is string => typeof value === 'string');
}

function claimEntityIds(claims: Record<string, Snak[]> | undefined, prop: string): string[] {
  return claimValues(claims, prop)
    .map((value) =>
      value && typeof value === 'object' && 'id' in value
        ? String((value as { id: unknown }).id)
        : null,
    )
    .filter((id): id is string => Boolean(id));
}

function claimYear(claims: Record<string, Snak[]> | undefined, prop: string): number | null {
  for (const value of claimValues(claims, prop)) {
    if (value && typeof value === 'object' && 'time' in value) {
      const match = String((value as { time: unknown }).time).match(/(\d{4})/);
      if (match) {
        const year = Number(match[1]);
        if (year >= 1000 && year <= 2100) return year;
      }
    }
  }
  return null;
}

/**
 * Headcount, preferring the most recently qualified figure.
 *
 * Wikidata carries a series of employee counts, one per year, and taking the
 * first is how you end up telling someone a company has 40 people six years
 * after it had 4,000.
 */
function employeeCount(
  claims: Record<string, Snak[]> | undefined,
): { count: number; asOf: number | null } | null {
  let best: { count: number; asOf: number | null } | null = null;

  for (const snak of claims?.[PROP_EMPLOYEES] ?? []) {
    const value = snak.mainsnak?.datavalue?.value;
    if (!value || typeof value !== 'object' || !('amount' in value)) continue;
    const count = Number(String((value as { amount: unknown }).amount).replace(/^\+/, ''));
    if (!Number.isFinite(count) || count <= 0) continue;

    let asOf: number | null = null;
    for (const qualifier of snak.qualifiers?.P585 ?? []) {
      const time = qualifier.datavalue?.value;
      if (time && typeof time === 'object' && 'time' in time) {
        const match = String((time as { time: unknown }).time).match(/(\d{4})/);
        if (match) asOf = Number(match[1]);
      }
    }

    if (!best || (asOf ?? 0) > (best.asOf ?? 0)) best = { count, asOf };
  }

  return best;
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function commonsImageUrl(filename: string): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=256`;
}

export type WikidataOptions = {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
};

function request(options: WikidataOptions) {
  return {
    provider: 'wikidata',
    fetch: options.fetch,
    headers: { 'User-Agent': USER_AGENT },
  } as const;
}

/** Turn one entity payload into a company, or null if it is not one. */
export function toCompany(
  id: string,
  entity: NonNullable<EntitiesResponse['entities']>[string] | undefined,
  labels: Map<string, string>,
): WikidataCompany | null {
  if (!entity) return null;
  const claims = entity.claims;
  const label = entity.labels?.en?.value?.trim();
  if (!label) return null;

  const classes = claimEntityIds(claims, PROP_INSTANCE_OF);
  const website = claimStrings(claims, PROP_WEBSITE)[0] ?? null;

  // An organisation class is the primary test; an official website plus a
  // named industry is enough on its own, because Wikidata's class hierarchy is
  // deep and plenty of real employers sit under a term not on the list.
  const looksLikeOrganisation =
    classes.some((klass) => ORGANISATION_CLASSES.has(klass)) ||
    (Boolean(website) && claimEntityIds(claims, PROP_INDUSTRY).length > 0);
  if (!looksLikeOrganisation) return null;

  const headcount = employeeCount(claims);
  const logo = claimStrings(claims, PROP_LOGO)[0] ?? null;
  const linkedin = claimStrings(claims, PROP_LINKEDIN)[0] ?? null;

  const industryIds = claimEntityIds(claims, PROP_INDUSTRY);
  const hqIds = claimEntityIds(claims, PROP_HEADQUARTERS);
  const countryIds = claimEntityIds(claims, PROP_COUNTRY);

  const hqName = hqIds.map((hq) => labels.get(hq)).find(Boolean) ?? null;
  const countryName = countryIds.map((c) => labels.get(c)).find(Boolean) ?? null;

  return {
    wikidataId: id,
    label,
    description: entity.descriptions?.en?.value?.trim() ?? null,
    websiteDomain: domainOf(website),
    websiteUrl: website,
    industry:
      industryIds
        .map((industry) => labels.get(industry))
        .filter((name): name is string => Boolean(name))
        .slice(0, 2)
        .join(', ') || null,
    headquarters:
      hqName && countryName && hqName !== countryName
        ? `${hqName}, ${countryName}`
        : (hqName ?? countryName),
    employees: headcount?.count ?? null,
    employeesAsOf: headcount?.asOf ?? null,
    foundedYear: claimYear(claims, PROP_INCEPTION),
    isPublicCompany: classes.includes(PUBLIC_COMPANY),
    logoUrl: logo ? commonsImageUrl(logo) : null,
    linkedinUrl: linkedin ? `https://www.linkedin.com/company/${linkedin}` : null,
  };
}

export function createWikidataCompanyProvider(options: WikidataOptions = {}) {
  const baseUrl = options.baseUrl ?? API_URL;

  return {
    /**
     * Name → candidate companies, best first.
     *
     * Three round trips at most: search, entities, then one batched call to
     * turn the industry and headquarters item ids into readable names, because
     * Wikidata stores those as references rather than strings.
     */
    async searchCompanies(name: string): Promise<WikidataCompany[]> {
      const trimmed = name.trim();
      if (!trimmed) return [];

      const searchUrl = `${baseUrl}?action=wbsearchentities&search=${encodeURIComponent(
        trimmed,
      )}&language=en&uselang=en&type=item&limit=7&format=json&origin=*`;
      const found = await getJson<SearchResponse>(searchUrl, request(options));

      const ids = (found?.search ?? [])
        .map((entry) => entry.id)
        .filter((id): id is string => Boolean(id))
        .slice(0, 7);
      if (ids.length === 0) return [];

      const entities = await this.loadEntities(ids);
      return ids
        .map((id) => entities.get(id))
        .filter((company): company is WikidataCompany => company !== null && company !== undefined);
    },

    /** Fetch entities by id and resolve their referenced labels in one pass. */
    async loadEntities(ids: string[]): Promise<Map<string, WikidataCompany | null>> {
      const unique = [...new Set(ids)].slice(0, 20);
      const out = new Map<string, WikidataCompany | null>();
      if (unique.length === 0) return out;

      const entitiesUrl = `${baseUrl}?action=wbgetentities&ids=${unique.join(
        '|',
      )}&props=claims|labels|descriptions&languages=en&format=json&origin=*`;
      const data = await getJson<EntitiesResponse>(entitiesUrl, request(options));

      // Industry and headquarters come back as item ids; collect them all and
      // resolve in one call rather than one per company.
      const referenced = new Set<string>();
      for (const id of unique) {
        const claims = data?.entities?.[id]?.claims;
        for (const prop of [PROP_INDUSTRY, PROP_HEADQUARTERS, PROP_COUNTRY]) {
          for (const ref of claimEntityIds(claims, prop)) referenced.add(ref);
        }
      }

      const labels = await this.labelsFor([...referenced]);
      for (const id of unique) out.set(id, toCompany(id, data?.entities?.[id], labels));
      return out;
    },

    async labelsFor(ids: string[]): Promise<Map<string, string>> {
      const unique = [...new Set(ids)].slice(0, 50);
      const names = new Map<string, string>();
      if (unique.length === 0) return names;

      const url = `${baseUrl}?action=wbgetentities&ids=${unique.join(
        '|',
      )}&props=labels&languages=en&format=json&origin=*`;
      const data = await getJson<EntitiesResponse>(url, request(options));
      for (const id of unique) {
        const label = data?.entities?.[id]?.labels?.en?.value?.trim();
        if (label) names.set(id, label);
      }
      return names;
    },
  };
}

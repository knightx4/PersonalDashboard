/**
 * URL -> vendor + board token + job id.
 *
 * Pure and testable: no fetching happens here. Detection is what decides which
 * of the three JD fetch tiers applies, and getting it right is the difference
 * between a one-paste role and a manual copy.
 */

export type AtsVendor =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday'
  | 'icims'
  | 'smartrecruiters'
  | 'workable'
  | 'recruitee'
  | 'breezy'
  | 'bamboohr'
  | 'rippling'
  | 'taleo'
  | 'linkedin'
  | 'wellfound'
  | 'indeed'
  | 'other'
  | 'unknown';

/**
 * The vendors that publish a whole board without a key.
 *
 * The same nine that `tier: 1` picks out above, named as a set because board
 * discovery reasons about vendors rather than about URLs: given only a company
 * and a guessed token, these are the doors worth knocking on.
 */
export const BOARD_VENDORS = [
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
  'workable',
  'recruitee',
  'breezy',
  'bamboohr',
  'rippling',
] as const;

export type BoardVendor = (typeof BOARD_VENDORS)[number];

export function isBoardVendor(vendor: string | null | undefined): vendor is BoardVendor {
  return (BOARD_VENDORS as readonly string[]).includes(vendor as string);
}

export interface DetectedPosting {
  vendor: AtsVendor;
  /** The company's board slug, when the URL carries one. */
  boardToken: string | null;
  /** The posting id, when the URL carries one. */
  jobId: string | null;
  /** Which fetch tier can serve this URL. */
  tier: 1 | 2 | 3;
  /** Shown to the user when tier is 3, so a failure is explained not silent. */
  reason?: string;
}

/**
 * Sites that render the posting through session-bound JavaScript or actively
 * block automated fetching. Stated explicitly so nobody spends a day trying:
 * for these, pasting the JD takes about eight seconds and always works.
 */
const HOSTILE: Array<{ test: RegExp; vendor: AtsVendor; reason: string }> = [
  {
    test: /(^|\.)linkedin\.com$/i,
    vendor: 'linkedin',
    reason:
      'LinkedIn blocks automated fetching of job pages. Paste the description instead — it takes about eight seconds.',
  },
  {
    test: /(^|\.)(myworkday(jobs)?\.com|workday\.com)$/i,
    vendor: 'workday',
    reason:
      'Workday renders postings through a session-bound script, so there is nothing to fetch. Paste the description instead.',
  },
  {
    test: /(^|\.)icims\.com$/i,
    vendor: 'icims',
    reason:
      'iCIMS renders postings behind a session, so there is nothing to fetch. Paste the description instead.',
  },
  {
    test: /(^|\.)(taleo\.net|oraclecloud\.com)$/i,
    vendor: 'taleo',
    reason:
      'Taleo renders postings behind a session, so there is nothing to fetch. Paste the description instead.',
  },
  {
    test: /(^|\.)indeed\.com$/i,
    vendor: 'indeed',
    reason: 'Indeed blocks automated fetching. Paste the description instead.',
  },
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function detectPosting(rawUrl: string): DetectedPosting {
  const url = rawUrl.trim();
  const host = hostOf(url);
  if (!host) {
    return { vendor: 'unknown', boardToken: null, jobId: null, tier: 3, reason: 'That does not look like a URL.' };
  }

  const parsed = new URL(url);
  const path = parsed.pathname;

  for (const entry of HOSTILE) {
    if (entry.test.test(host)) {
      return { vendor: entry.vendor, boardToken: null, jobId: null, tier: 3, reason: entry.reason };
    }
  }

  // Greenhouse: boards.greenhouse.io/{board}/jobs/{id}
  //             job-boards.greenhouse.io/{board}/jobs/{id}
  //             {board}.greenhouse.io  (embedded boards)
  if (/(^|\.)greenhouse\.io$/i.test(host)) {
    const match = path.match(/^\/(?:embed\/job_app\?for=)?([^/]+)(?:\/jobs\/(\d+))?/);
    const forParam = parsed.searchParams.get('for');
    const idParam = parsed.searchParams.get('gh_jid') ?? parsed.searchParams.get('token');
    const subdomain = host.replace(/\.greenhouse\.io$/i, '');
    const boardToken =
      forParam ??
      (match?.[1] && match[1] !== 'embed' ? match[1] : null) ??
      (subdomain && !['boards', 'job-boards', 'my', 'www'].includes(subdomain) ? subdomain : null);
    return {
      vendor: 'greenhouse',
      boardToken,
      jobId: match?.[2] ?? idParam,
      tier: 1,
    };
  }

  // Lever: jobs.lever.co/{company}/{posting-uuid}
  if (/(^|\.)lever\.co$/i.test(host)) {
    const match = path.match(/^\/([^/]+)(?:\/([0-9a-f-]{8,}))?/i);
    return { vendor: 'lever', boardToken: match?.[1] ?? null, jobId: match?.[2] ?? null, tier: 1 };
  }

  // Ashby: jobs.ashbyhq.com/{board}/{posting-uuid}
  if (/(^|\.)ashbyhq\.com$/i.test(host)) {
    const match = path.match(/^\/([^/]+)(?:\/([0-9a-f-]{8,}))?/i);
    return { vendor: 'ashby', boardToken: match?.[1] ?? null, jobId: match?.[2] ?? null, tier: 1 };
  }

  // Workable: apply.workable.com/{company}/j/{shortcode}/
  //           {company}.workable.com/j/{shortcode}
  if (/(^|\.)workable\.com$/i.test(host)) {
    const match = path.match(/^\/([^/]+)\/j\/([^/]+)/i) ?? path.match(/^\/j\/([^/]+)/i);
    const subdomain = host.replace(/\.workable\.com$/i, '');
    const scoped = match && match.length === 3;
    const boardToken = scoped
      ? match[1]
      : subdomain && !['apply', 'www', 'jobs'].includes(subdomain)
        ? subdomain
        : null;
    return {
      vendor: 'workable',
      boardToken,
      jobId: (scoped ? match[2] : match?.[1]) ?? null,
      tier: 1,
    };
  }

  // SmartRecruiters: jobs.smartrecruiters.com/{company}/{numeric-id}-{slug}
  if (/(^|\.)smartrecruiters\.com$/i.test(host)) {
    const match = path.match(/^\/([^/]+)\/(\d+)/);
    return { vendor: 'smartrecruiters', boardToken: match?.[1] ?? null, jobId: match?.[2] ?? null, tier: match?.[2] ? 1 : 2 };
  }

  // Recruitee: {company}.recruitee.com/o/{slug}
  if (/(^|\.)recruitee\.com$/i.test(host)) {
    const subdomain = host.replace(/\.recruitee\.com$/i, '');
    const match = path.match(/^\/o\/([^/]+)/i);
    return {
      vendor: 'recruitee',
      boardToken: subdomain && !['www', 'jobs'].includes(subdomain) ? subdomain : null,
      jobId: match?.[1] ?? null,
      tier: 1,
    };
  }

  // Breezy: {company}.breezy.hr/p/{id}-{slug}
  if (/(^|\.)breezy\.hr$/i.test(host)) {
    const subdomain = host.replace(/\.breezy\.hr$/i, '');
    const match = path.match(/^\/p\/([0-9a-f]+)/i);
    return {
      vendor: 'breezy',
      boardToken: subdomain && !['app', 'www'].includes(subdomain) ? subdomain : null,
      jobId: match?.[1] ?? null,
      tier: 1,
    };
  }

  // BambooHR: {company}.bamboohr.com/careers/{id}
  if (/(^|\.)bamboohr\.com$/i.test(host)) {
    const subdomain = host.replace(/\.bamboohr\.com$/i, '');
    const match = path.match(/^\/careers\/(\d+)/);
    return {
      vendor: 'bamboohr',
      boardToken: subdomain && subdomain !== 'www' ? subdomain : null,
      jobId: match?.[1] ?? null,
      tier: 1,
    };
  }

  // Rippling: ats.rippling.com/{board}/jobs/{uuid}
  if (/(^|\.)rippling(ats)?\.com$/i.test(host)) {
    const match = path.match(/^\/([^/]+)\/jobs\/([0-9a-f-]{8,})/i);
    return {
      vendor: 'rippling',
      boardToken: match?.[1] ?? null,
      jobId: match?.[2] ?? null,
      tier: match?.[1] ? 1 : 2,
    };
  }

  if (/(^|\.)wellfound\.com$|(^|\.)angel\.co$/i.test(host)) {
    return { vendor: 'wellfound', boardToken: null, jobId: null, tier: 2 };
  }

  // Anything else: a company careers page. Tier 2 reads JSON-LD if it is there.
  return { vendor: 'other', boardToken: null, jobId: null, tier: 2 };
}

/**
 * Whether the application form's questions can be fetched for this vendor.
 *
 * Greenhouse is the good case and it genuinely works: `?questions=true` on the
 * job endpoint returns the typed field list with required flags. Everything
 * else is the bookmarklet's job, which is why the bookmarklet is in the MVP
 * rather than deferred to a browser extension.
 */
export function supportsQuestionFetch(vendor: AtsVendor): boolean {
  return vendor === 'greenhouse';
}

import { PERSPECTIVE_QUESTIONS, type PerspectiveKey } from './perspective';

/**
 * Prepared research on a company (job_search.company_research,
 * migrations-job-search/0062): what the company research routine found when
 * the person pressed Research on the Perspective tab. The routine writes the
 * row through the Supabase connector (.claude/skills/company-research); this
 * reads it back for the tab, defensively, since jsonb written by a session is
 * only as well-formed as that session was careful.
 */

export type ResearchStatus = 'queued' | 'researching' | 'ready' | 'failed';

export type ResearchSection = { key: string; title: string; body: string };

/** What kind of page a source is, which is how the tab groups them. */
export const SOURCE_KINDS = [
  { kind: 'company', label: 'Their own materials' },
  { kind: 'filing', label: 'Filings and financials' },
  { kind: 'talk', label: 'Talks, podcasts and interviews' },
  { kind: 'news', label: 'News' },
  { kind: 'analysis', label: 'Analysis and commentary' },
  { kind: 'posting', label: 'Job postings' },
  { kind: 'mail', label: 'Your mail and notes' },
  { kind: 'other', label: 'Other' },
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number]['kind'];

export type ResearchSource = {
  url: string;
  title: string;
  kind: SourceKind;
  publisher: string | null;
  publishedOn: string | null;
  note: string | null;
};

export type CompanyResearch = {
  id: string;
  status: ResearchStatus;
  summary: string;
  sections: ResearchSection[];
  sources: ResearchSource[];
  drafts: Partial<Record<PerspectiveKey, string>>;
  error: string | null;
  runUrl: string | null;
  requestedAt: string;
  finishedAt: string | null;
};

export const RESEARCH_COLUMNS =
  'id, status, summary, sections, sources, drafts, error, run_url, requested_at, finished_at';

/**
 * How long a run may sit queued or researching before it is taken as dead.
 * A run takes 20 to 40 minutes; one that has said nothing for three hours
 * stopped without writing, and would otherwise block the next press forever.
 */
export const STALE_AFTER_MS = 3 * 60 * 60 * 1000;

const STATUSES: readonly ResearchStatus[] = ['queued', 'researching', 'ready', 'failed'];

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/** A link the tab may put in an href: http or https, nothing else. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function sectionsOf(value: unknown): ResearchSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const body = text(row.body).trim();
    const title = text(row.title).trim();
    if (!body || !title) return [];
    return [{ key: text(row.key) || `section-${index}`, title, body }];
  });
}

function sourcesOf(value: unknown): ResearchSource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    const url = safeUrl(row.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const kind = SOURCE_KINDS.find((entry) => entry.kind === row.kind)?.kind ?? 'other';
    return [
      {
        url,
        title: text(row.title).trim() || new URL(url).hostname,
        kind,
        publisher: textOrNull(row.publisher),
        publishedOn: textOrNull(row.published_on),
        note: textOrNull(row.note),
      },
    ];
  });
}

function draftsOf(value: unknown): Partial<Record<PerspectiveKey, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const row = value as Record<string, unknown>;
  const drafts: Partial<Record<PerspectiveKey, string>> = {};
  for (const question of PERSPECTIVE_QUESTIONS) {
    const draft = text(row[question.key]).trim();
    if (draft) drafts[question.key] = draft;
  }
  return drafts;
}

/** A company_research row as the tab reads it. */
export function researchFromRow(row: Record<string, unknown>): CompanyResearch {
  const status = STATUSES.find((entry) => entry === row.status) ?? 'failed';
  return {
    id: text(row.id),
    status,
    summary: text(row.summary).trim(),
    sections: sectionsOf(row.sections),
    sources: sourcesOf(row.sources),
    drafts: draftsOf(row.drafts),
    error: textOrNull(row.error),
    runUrl: safeUrl(row.run_url),
    requestedAt: text(row.requested_at),
    finishedAt: textOrNull(row.finished_at),
  };
}

/** The sources grouped by kind, in the tab's order, leaving out empty kinds. */
export function sourcesByKind(
  sources: readonly ResearchSource[],
): Array<{ kind: SourceKind; label: string; sources: ResearchSource[] }> {
  return SOURCE_KINDS.map((entry) => ({
    ...entry,
    sources: sources.filter((source) => source.kind === entry.kind),
  })).filter((group) => group.sources.length > 0);
}

/**
 * The brief the goals routine is fired with. Its first line hands the session
 * to the company research skill (the goals skill, "Jobs that follow another
 * skill"); the skill reads the row by its id and the user id, so nothing else
 * it needs has to fit in here.
 */
export function researchBrief(input: {
  researchId: string;
  userId: string;
  companyName: string;
  companySlug: string;
  previousId: string | null;
}): string {
  return [
    'Follow .claude/skills/company-research/SKILL.md',
    `Company research ${input.researchId}`,
    `user_id ${input.userId}`,
    `company ${input.companyName} (${input.companySlug})`,
    input.previousId ? `refresh of ${input.previousId}` : 'first run',
  ].join('\n');
}

/**
 * The discovered companies on Find (feature #1679): the watchlist as the
 * person reads it, best fit first, and a line saying how the latest
 * discovery run went. Pure, so the section and the gallery draw from the
 * same rows; watchlist-load.ts reads them.
 */
import { agoText } from '@/lib/jobs/suggest/search-runs';

export type DiscoveredCompany = {
  id: string;
  name: string;
  website: string | null;
  source: 'yc' | 'hn';
  /** What the company does, in the source's own words. */
  description: string | null;
  /** Why Dash shortlisted it, written to the person. */
  reason: string | null;
  /** Dash's fit score from 1 to 100; null on rows shortlisted before scores. */
  score: number | null;
  /** 'Early' or 'Growth', as YC gives it. */
  stage: string | null;
  locations: string[];
  /** The roles a Hacker News post names. */
  postingRoles: string[];
  board: { vendor: string } | null;
  /** True once a board was looked for and none was found. */
  noBoard: boolean;
  /** The companies page it became when a role of its was saved. */
  companySlug: string | null;
};

export type DiscoveryRunView = {
  stage: string;
  startedAt: string;
  finishedAt: string | null;
  offered: number;
  added: number;
  refreshed: number;
  boardsFound: number;
  error: string | null;
};

export const DISCOVERY_SOURCE_LABELS: Record<DiscoveredCompany['source'], string> = {
  yc: 'YC',
  hn: 'Hacker News',
};

const VENDOR_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  workable: 'Workable',
  recruitee: 'Recruitee',
  breezy: 'Breezy',
  bamboohr: 'BambooHR',
  rippling: 'Rippling',
};

export function vendorLabel(vendor: string): string {
  return VENDOR_LABELS[vendor] ?? vendor;
}

/** Best fit first; a company with no score after every scored one, then by name. */
export function rankCompanies(companies: readonly DiscoveredCompany[]): DiscoveredCompany[] {
  return [...companies].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name),
  );
}

/** "Early stage", "New York; Remote", the posted roles: the facts under the name. */
export function companyFacts(company: DiscoveredCompany): string[] {
  const facts: string[] = [];
  if (company.stage) facts.push(`${company.stage} stage`);
  if (company.locations.length > 0) facts.push(company.locations.slice(0, 3).join('; '));
  facts.push(`Found on ${DISCOVERY_SOURCE_LABELS[company.source]}`);
  if (company.board) facts.push(`Jobs on ${vendorLabel(company.board.vendor)}`);
  else if (company.noBoard) facts.push('No job board Dash can read');
  return facts;
}

/** A run still working this long after it started was cut off (weekly.ts). */
const STOPPED_AFTER_MS = 8 * 60_000;

export type DiscoveryLine = { running: boolean; tone: 'plain' | 'warn'; text: string };

export function describeDiscovery(run: DiscoveryRunView | null, now: Date = new Date()): DiscoveryLine | null {
  if (!run) return null;
  const when = agoText(run.finishedAt ?? run.startedAt, now);
  if (run.stage === 'failed') {
    return { running: false, tone: 'warn', text: `The startup search ${when} failed: ${run.error ?? 'no reason was given'}` };
  }
  if (run.stage !== 'done') {
    if (now.getTime() - new Date(run.startedAt).getTime() > STOPPED_AFTER_MS) {
      return { running: false, tone: 'warn', text: `The startup search ${when} stopped before it finished.` };
    }
    return { running: true, tone: 'plain', text: `Looking for startups… Started ${agoText(run.startedAt, now)}. This takes a minute or two.` };
  }
  const boards = `${run.boardsFound} more job ${run.boardsFound === 1 ? 'board' : 'boards'}`;
  // A run that only looked for boards (the shortlist was written earlier
  // that week) read no lists.
  if (run.offered === 0) return { running: false, tone: 'plain', text: `The startup search ${when} found ${boards}.` };
  return {
    running: false,
    tone: 'plain',
    text: `The startup search ${when} read ${run.offered.toLocaleString('en-US')} hiring startups that fit your preferences, kept ${run.added + run.refreshed} and found ${boards}.`,
  };
}

/**
 * What the person wants from a job, as rules (job_search 0039): where they
 * live, how they want to work, the lowest pay worth applying for and the
 * company stages they want. Set on /jobs/settings.
 *
 * The roles search is told them, Jev reads them beside each posting, and
 * `preferenceMisses` names where a posting falls outside them, from what the
 * posting's own text states. Pure, so the Roles list and the tests share it.
 */

export const WORKPLACE_PREFERENCES = ['remote', 'hybrid', 'on_site'] as const;
export type WorkplacePreference = (typeof WORKPLACE_PREFERENCES)[number];

export const WORKPLACE_PREFERENCE_LABELS: Record<WorkplacePreference, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  on_site: 'On-site',
};

export const COMPANY_STAGES = ['early', 'growth', 'late', 'public'] as const;
export type CompanyStage = (typeof COMPANY_STAGES)[number];

export const COMPANY_STAGE_LABELS: Record<CompanyStage, string> = {
  early: 'Early-stage startup',
  growth: 'Growth-stage startup',
  late: 'Late-stage private company',
  public: 'Public or large company',
};

export type JobPreferences = {
  homeLocation: string | null;
  /** Empty means any. */
  workplaces: readonly WorkplacePreference[];
  /** Base pay per year, in cents. */
  salaryFloorCents: number | null;
  /** Empty means any. */
  companyStages: readonly CompanyStage[];
};

export const NO_PREFERENCES: JobPreferences = {
  homeLocation: null,
  workplaces: [],
  salaryFloorCents: null,
  companyStages: [],
};

/** The stored profile columns as preferences, dropping anything the lists do not name. */
export function readPreferences(row: Record<string, unknown> | null | undefined): JobPreferences {
  const list = <T extends string>(value: unknown, allowed: readonly T[]): T[] =>
    Array.isArray(value) ? value.filter((v): v is T => (allowed as readonly unknown[]).includes(v)) : [];
  const floor = row?.salary_floor_cents;
  const home = typeof row?.home_location === 'string' ? row.home_location.trim() : '';
  return {
    homeLocation: home || null,
    workplaces: list(row?.workplace_preferences, WORKPLACE_PREFERENCES),
    salaryFloorCents: typeof floor === 'number' && floor > 0 ? floor : typeof floor === 'string' && Number(floor) > 0 ? Number(floor) : null,
    companyStages: list(row?.company_stages, COMPANY_STAGES),
  };
}

/** Whole dollars (or pounds, or euros) with thousands separators. */
export function formatPay(cents: number): string {
  return Math.round(cents / 100).toLocaleString('en-US');
}

/** The preferences as lines for a prompt; empty when none is set. */
export function preferenceLines(prefs: JobPreferences): string[] {
  const lines: string[] = [];
  if (prefs.homeLocation) lines.push(`Where they live or want to work: ${prefs.homeLocation}`);
  if (prefs.workplaces.length > 0) {
    lines.push(`How they will work: ${prefs.workplaces.map((w) => WORKPLACE_PREFERENCE_LABELS[w].toLowerCase()).join(' or ')}`);
  }
  if (prefs.salaryFloorCents) lines.push(`Lowest base pay worth applying for: ${formatPay(prefs.salaryFloorCents)} a year`);
  if (prefs.companyStages.length > 0) {
    lines.push(`Company stages they want: ${prefs.companyStages.map((s) => COMPANY_STAGE_LABELS[s].toLowerCase()).join(', ')}`);
  }
  return lines;
}

/** The preferences as Jev reads them, or null when none is set. */
export function preferenceState(prefs: JobPreferences): Record<string, unknown> | null {
  const state: Record<string, unknown> = {};
  if (prefs.homeLocation) state.home_location = prefs.homeLocation;
  if (prefs.workplaces.length > 0) state.workplaces = prefs.workplaces;
  if (prefs.salaryFloorCents) state.lowest_base_pay_per_year = Math.round(prefs.salaryFloorCents / 100);
  if (prefs.companyStages.length > 0) state.company_stages = prefs.companyStages;
  return Object.keys(state).length > 0 ? state : null;
}

/** The posting's work mode as the posting check stores it. */
export type PostingWorkMode = 'onsite' | 'hybrid' | 'remote';

const MODE_TO_PREFERENCE: Record<PostingWorkMode, WorkplacePreference> = {
  onsite: 'on_site',
  hybrid: 'hybrid',
  remote: 'remote',
};

/**
 * Where a posting falls outside the preferences, as short labels. Read only
 * from what the posting states: the top of its pay band against the floor,
 * and its work mode (the stored one from the text, else Jev's answer when it
 * was sure) against the workplaces asked for. A posting that states neither
 * misses nothing.
 */
export function preferenceMisses(
  posting: { compMaxCents: number | null; workMode: PostingWorkMode | null; workplaceAnswer?: WorkplacePreference | null },
  prefs: JobPreferences,
): string[] {
  const misses: string[] = [];
  if (prefs.salaryFloorCents && posting.compMaxCents !== null && posting.compMaxCents < prefs.salaryFloorCents) {
    misses.push('Pay below your floor');
  }
  const mode = posting.workMode ? MODE_TO_PREFERENCE[posting.workMode] : (posting.workplaceAnswer ?? null);
  if (prefs.workplaces.length > 0 && mode && !prefs.workplaces.includes(mode)) {
    misses.push(`${WORKPLACE_PREFERENCE_LABELS[mode]}, not how you want to work`);
  }
  return misses;
}

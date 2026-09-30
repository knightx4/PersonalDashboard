/**
 * How each source of recommended roles has done (job_search 0039): the weekly
 * web search, the followed companies' boards and the goals runs.
 *
 * For each: how many roles it found, how many the person saved, how many of
 * those they applied to, and how many reached an interview; how many they
 * turned down and how many Dash took off the list itself. The search's line
 * also carries what its searches have cost, which is what says whether the
 * paid search earns its place beside the free sources. Pure, so the counting
 * is tested apart from the page.
 */
import { reachedInterview, wasSent } from './history';

export const OPENING_ORIGINS = ['search', 'board', 'goal'] as const;
export type OpeningOrigin = (typeof OPENING_ORIGINS)[number];

export const OPENING_ORIGIN_LABELS: Record<OpeningOrigin, string> = {
  search: "Dash's web search",
  board: 'Boards you follow',
  goal: 'Goal steps',
};

/** One role suggestion with what came of it, as the stats read it. */
export type OpeningOutcome = {
  origin: string | null;
  status: string;
  /** The application made from it when it was saved, if any. */
  application: { status: string; rejectionStage: string | null; hasInterview: boolean } | null;
};

export type OriginStats = {
  origin: OpeningOrigin;
  found: number;
  saved: number;
  applied: number;
  interviews: number;
  dismissed: number;
  expired: number;
};

export function isOpeningOrigin(value: unknown): value is OpeningOrigin {
  return typeof value === 'string' && (OPENING_ORIGINS as readonly string[]).includes(value);
}

/** One line per source that has found anything, in OPENING_ORIGINS order. */
export function openingStats(rows: readonly OpeningOutcome[]): OriginStats[] {
  const by = new Map<OpeningOrigin, OriginStats>();
  for (const origin of OPENING_ORIGINS) {
    by.set(origin, { origin, found: 0, saved: 0, applied: 0, interviews: 0, dismissed: 0, expired: 0 });
  }
  for (const row of rows) {
    const stats = by.get(isOpeningOrigin(row.origin) ? row.origin : 'goal')!;
    stats.found += 1;
    if (row.status === 'dismissed') stats.dismissed += 1;
    if (row.status === 'expired') stats.expired += 1;
    if (row.status !== 'done') continue;
    stats.saved += 1;
    const app = row.application;
    if (!app || !wasSent(app)) continue;
    stats.applied += 1;
    if (reachedInterview({ id: '', title: '', company: null, ...app })) stats.interviews += 1;
  }
  return [...by.values()].filter((stats) => stats.found > 0);
}

/** A cost in micro-dollars as the stats line shows it. */
export function formatCost(micros: number): string {
  const dollars = micros / 1_000_000;
  return dollars >= 10 ? `$${Math.round(dollars)}` : `$${dollars.toFixed(2)}`;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { UI_SCOPES, type UiScope } from '@/lib/ui-review/scope';

/**
 * What the design reviews found, read for the dev pages.
 *
 * A review is one pass over one module: when it happened, which commit it was
 * against, what it found and what it left alone. The findings are rows of
 * their own so they can be worked one at a time — confirmed or dismissed —
 * rather than living in a session's report that nobody reads twice.
 *
 * The shape this returns has a row for every scope the gate counts, including
 * ones nobody has ever reviewed. That is the point: a module with no pass must
 * read as never reviewed and never as clean, and a loader that returned only
 * the rows it found would leave the page to guess which is which.
 */

/** Mirrors the `ui_findings_status_ck` check. */
export type UiFindingStatus = 'open' | 'confirmed' | 'dismissed';

export type UiFinding = {
  id: string;
  /** Repository-relative path. */
  file: string;
  /** Null when it is true of the whole file or of a surface. */
  line: number | null;
  /** The law it breaks, as numbered on /dev/ui. */
  law: string | null;
  /** The surface it was seen on, as an id from app/preview/surfaces.tsx. */
  surface: string | null;
  body: string;
  status: UiFindingStatus;
  /** Why it was dismissed, or what was done about it. */
  note: string | null;
  createdAt: string;
  /** When it was confirmed or dismissed. Null while it is a candidate. */
  decidedAt: string | null;
};

export type UiReview = {
  id: string;
  scope: UiScope;
  /** The commit the app was at when it was looked at. */
  commitSha: string | null;
  /** The mechanical count at the time of the pass, as the gate reported it. */
  violations: number | null;
  /** What the pass looked at and deliberately left alone. */
  note: string | null;
  createdAt: string;
  findings: UiFinding[];
};

/** One scope's standing: its last pass, or nothing if nobody has looked. */
export type ScopeReview = {
  scope: UiScope;
  /** Null means never reviewed, which is not the same as reviewed and clean. */
  lastReview: UiReview | null;
  /** Findings from that pass still waiting on you. */
  openFindings: UiFinding[];
};

/** Every column the app reads off a review, and the findings under it. */
export const UI_REVIEW_COLUMNS =
  'id, module, commit_sha, violations, note, created_at, ' +
  'findings:ui_findings(id, file, line, law, surface, body, status, note, created_at, decided_at)';

function findingsFrom(value: unknown): UiFinding[] {
  if (!Array.isArray(value)) return [];
  return (value as Array<Record<string, unknown>>)
    .map((row) => ({
      id: row.id as string,
      file: row.file as string,
      line: (row.line as number | null) ?? null,
      law: (row.law as string | null) ?? null,
      surface: (row.surface as string | null) ?? null,
      body: row.body as string,
      status: row.status as UiFindingStatus,
      note: (row.note as string | null) ?? null,
      createdAt: row.created_at as string,
      decidedAt: (row.decided_at as string | null) ?? null,
    }))
    // Undecided first, then oldest first: what still needs you is what the
    // page is for, and within that the order they were filed in.
    .sort((a, b) => {
      const undecided = Number(b.status === 'open') - Number(a.status === 'open');
      return undecided !== 0 ? undecided : a.createdAt.localeCompare(b.createdAt);
    });
}

/** A row as the app reads it. One shape leaves here, whoever selected it. */
export function uiReviewFrom(row: Record<string, unknown>): UiReview {
  return {
    id: row.id as string,
    // A module renamed in lib/modules leaves a harmless string in the column.
    // It reads back as itself rather than being coerced into a scope that
    // exists, and `byScope` below simply never asks for it.
    scope: row.module as UiScope,
    commitSha: (row.commit_sha as string | null) ?? null,
    violations: (row.violations as number | null) ?? null,
    note: (row.note as string | null) ?? null,
    createdAt: row.created_at as string,
    findings: findingsFrom(row.findings),
  };
}

/**
 * The newest pass per scope, with a row for every scope the gate counts.
 *
 * Pure, and given the reviews in any order: which pass is the latest is the
 * one thing this has to get right, and it should not need a database to say
 * so.
 */
export function byScope(reviews: readonly UiReview[]): ScopeReview[] {
  const latest = new Map<UiScope, UiReview>();
  for (const review of reviews) {
    const held = latest.get(review.scope);
    if (!held || review.createdAt > held.createdAt) latest.set(review.scope, review);
  }

  return UI_SCOPES.map((scope) => {
    const lastReview = latest.get(scope) ?? null;
    return {
      scope,
      lastReview,
      openFindings: lastReview?.findings.filter((finding) => finding.status === 'open') ?? [],
    };
  });
}

/**
 * Takes a client rather than building one, like everything else in lib/. The
 * page reads as you, so it goes through RLS.
 */
export async function loadUiReviews(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public'>,
  userId: string,
): Promise<ScopeReview[]> {
  const { data } = await supabase
    .from('ui_reviews')
    .select(UI_REVIEW_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);

  // Through `unknown`: the column list is built as an expression, so the
  // client cannot infer a row shape from it and types the result as its error
  // case instead.
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

  return byScope(rows.map(uiReviewFrom));
}

import type { PipelineRow } from '@/lib/jobs/applications/load';
import { APPLICATION_SOURCES, isLive, type ApplicationSource } from '@/lib/jobs/pipeline';
import { matchesSearch, searchTerms } from '@/lib/jobs/search';
import { parseScoreMinimum, passesMinimum, type ScoreMinimum } from '@/lib/jobs/suggest/score-notes';

/**
 * What the Pipeline page shows, read from its address (plan #1590).
 *
 * Pipeline and Roles were two pages over the same rows. They are one page now,
 * with a board view and a table view, and both open on the live applications
 * only. The closed ones are a status filter on the table, a page at a time,
 * rather than a fold under the board that drew every one of them as a card.
 *
 * Everything is in the URL, the view included, so a link to the table with
 * the closed applications sorted by date is a link anybody can open again.
 */

export const PIPELINE_PATH = '/jobs/pipeline';

/**
 * Focus is the default (the live applications read top to bottom by where
 * they stand, components/jobs/pipeline/focus.tsx); the board is for dragging
 * and the table for sorting and the closed ones.
 */
export type PipelineViewName = 'focus' | 'board' | 'table';

/** Which applications are in play: the live ones, the closed ones or every one. */
export type PipelineScope = 'live' | 'closed' | 'all';

/** How many rows the table draws at once. */
export const PIPELINE_PAGE_SIZE = 50;

/** The search params the page reads. Sort, group and hide are the table's. */
export type PipelineParams = {
  view?: string;
  status?: string;
  source?: string;
  excitement?: string;
  minfit?: string;
  minchance?: string;
  q?: string;
  page?: string;
  sort?: string;
  group?: string;
  hide?: string | string[];
};

export type PipelineState = {
  view: PipelineViewName;
  scope: PipelineScope;
  source: ApplicationSource | null;
  /** The lowest excitement shown, or null for any. */
  excitement: number | null;
  minimum: ScoreMinimum;
  terms: string[];
  /** One-based. */
  page: number;
};

export const EXCITEMENT_MINIMUMS = [5, 4, 3] as const;

export function parsePipeline(params: PipelineParams): PipelineState {
  const scope: PipelineScope =
    params.status === 'closed' || params.status === 'all' ? params.status : 'live';
  // Focus and the board are the live applications; asking either for the
  // closed ones means the table, which is where they are kept.
  const view: PipelineViewName =
    params.view === 'table' || scope !== 'live' ? 'table' : params.view === 'board' ? 'board' : 'focus';
  const excitement = Number(params.excitement);
  const page = Number(params.page);
  return {
    view,
    scope,
    source: APPLICATION_SOURCES.find((s) => s === params.source) ?? null,
    excitement: (EXCITEMENT_MINIMUMS as readonly number[]).includes(excitement) ? excitement : null,
    minimum: parseScoreMinimum(params),
    terms: searchTerms(params.q),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** Whether a row is in the scope, by the one live rule (lib/jobs/pipeline.ts). */
export function inScope(row: Pick<PipelineRow, 'status'>, scope: PipelineScope): boolean {
  if (scope === 'all') return true;
  return scope === 'live' ? isLive(row.status) : !isLive(row.status);
}

/**
 * The rows in scope, and those of them every other filter lets through. The
 * rails count from `scoped`, so a source's count is what choosing it would
 * show among the applications already in view.
 */
export function filterPipeline(
  rows: readonly PipelineRow[],
  state: PipelineState,
): { scoped: PipelineRow[]; filtered: PipelineRow[] } {
  const scoped = rows.filter((row) => inScope(row, state.scope));
  const filtered = scoped.filter(
    (row) =>
      (!state.source || row.source === state.source) &&
      (!state.excitement || (row.excitement ?? 0) >= state.excitement) &&
      // A row not scored passes, as an unscored opening passes the openings' filters.
      passesMinimum(row.scoreNote, state.minimum) &&
      (state.terms.length === 0 || matchesSearch([row.companyName, row.roleTitle], state.terms)),
  );
  return { scoped, filtered };
}

/** The page of `rows` to draw, with where it starts and how many pages there are. */
export function pageOf<T>(
  rows: readonly T[],
  page: number,
  size = PIPELINE_PAGE_SIZE,
): { rows: T[]; page: number; pages: number; first: number; last: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  return {
    rows: slice,
    page: current,
    pages,
    first: slice.length ? start + 1 : 0,
    last: start + slice.length,
  };
}

/** The params as plain strings, the way a link carries them. */
function flatten(params: PipelineParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      if (value.length) out[key] = value.join(',');
    } else if (value) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * The link that changes `changes` and keeps everything else. A filter or a
 * view change goes back to the first page, since page 4 of a different list
 * is nobody's place in it; only a change of page keeps the page.
 */
export function pipelineHref(
  params: PipelineParams,
  changes: Partial<Record<keyof PipelineParams, string | undefined>>,
): string {
  const next = flatten(params);
  if (!('page' in changes)) delete next.page;
  for (const [key, value] of Object.entries(changes)) {
    if (value) next[key] = value;
    else delete next[key];
  }
  // The defaults stay out of the address, so the bare page is the bare link.
  if (next.view === 'focus') delete next.view;
  if (next.status === 'live') delete next.status;
  if (next.page === '1') delete next.page;
  const query = new URLSearchParams(next).toString();
  return query ? `${PIPELINE_PATH}?${query}` : PIPELINE_PATH;
}

/** Where an old /jobs/roles link lands: the table, with what it asked for. */
export function rolesRedirect(params: PipelineParams): string {
  return pipelineHref(params, { view: 'table' });
}

/** The params without the page, for the links that rearrange the table. */
export function withoutPage(params: PipelineParams): PipelineParams {
  const rest = { ...params };
  delete rest.page;
  return rest;
}

/** The header's line: how many are shown, out of how many, of which kind. */
export function pipelineDescription(
  state: PipelineState,
  shown: number,
  inScopeCount: number,
  query: string | undefined,
): string {
  const noun =
    state.scope === 'live'
      ? inScopeCount === 1 ? 'live application' : 'live applications'
      : state.scope === 'closed'
        ? inScopeCount === 1 ? 'closed application' : 'closed applications'
        : inScopeCount === 1 ? 'application' : 'applications';
  if (state.terms.length) return `${shown} of ${inScopeCount} ${noun} match “${query ?? ''}”.`;
  if (shown === inScopeCount) return `${inScopeCount} ${noun}.`;
  return `${shown} of ${inScopeCount} ${noun} shown.`;
}

import type { PipelineRow } from '@/lib/jobs/applications/load';
import {
  APPLICATION_SOURCES,
  isLive,
  type ApplicationSource,
  type ApplicationStatus,
} from '@/lib/jobs/pipeline';
import { matchesSearch, searchTerms } from '@/lib/jobs/search';
import { parseScoreMinimum, passesMinimum, type ScoreMinimum } from '@/lib/jobs/suggest/score-notes';
import {
  TABLE_PAGE_SIZE,
  addressHref,
  pageOf,
  parsePage,
  withoutPage,
  type PageAddress,
} from '@/lib/table-view';

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

/**
 * The stages Today counts and Pipeline can be narrowed to (plan #1591): the
 * board's columns, folded the way the board folds them. `submitted` and
 * `acknowledged` are one column, and so are `in_process` and `final_round`.
 * Together they are every live status, so the stage counts add up to the
 * live count. Leads and drafting are two, named as the board and the table
 * name them: one "Not sent yet" filter over rows reading "Lead" was the
 * mismatch note 6d8f73b1 reported.
 */
export const PIPELINE_STAGES = [
  { key: 'lead', label: 'Leads', statuses: ['lead'] },
  { key: 'drafting', label: 'Drafting', statuses: ['drafting'] },
  { key: 'submitted', label: 'Submitted', statuses: ['submitted', 'acknowledged'] },
  { key: 'in_process', label: 'In process', statuses: ['in_process', 'final_round'] },
  { key: 'offer', label: 'Offer', statuses: ['offer'] },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  statuses: readonly ApplicationStatus[];
}>;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type PipelineStageKey = PipelineStage['key'];

/** The longest look-back `sent` takes, in days. */
export const SENT_MAX_DAYS = 90;

/** How many rows the table draws at once. */
export const PIPELINE_PAGE_SIZE = TABLE_PAGE_SIZE;

// Paging and the table's links are the shared table module's; Pipeline's
// callers keep importing them from here.
export { pageOf, withoutPage };

/** The search params the page reads. Sort, group and hide are the table's. */
export type PipelineParams = {
  view?: string;
  status?: string;
  source?: string;
  excitement?: string;
  minfit?: string;
  minchance?: string;
  q?: string;
  /** A stage key from PIPELINE_STAGES: only the live applications at that stage. */
  stage?: string;
  /** A number of days: only what was sent within that many days, live or closed. */
  sent?: string;
  /** `yes` ready to apply, `no` not marked ready (plan #2102.3). */
  ready?: string;
  /** `yes` all its questions added, `no` not marked so. */
  questions?: string;
  /** `yes` has a cover letter, `no` marked as having none; unanswered is neither. */
  letter?: string;
  /** `yes` has questions added or a cover letter, `no` has neither (note 732901e4). */
  material?: string;
  /** A company's slug: only its applications, set from the table's Company column. */
  company?: string;
  page?: string;
  sort?: string;
  /** `rev` runs the sort the other way (note fd6c7ef2). */
  dir?: string;
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
  stage: PipelineStage | null;
  /** Sent within this many days, or null for any time. */
  sentDays: number | null;
  /** Ready to apply (true), not marked ready (false), or either (null). */
  ready: boolean | null;
  /** All questions added (true), not marked so (false), or either (null). */
  questions: boolean | null;
  /** Has a cover letter (true), marked as having none (false), or either (null). */
  letter: boolean | null;
  /** Has questions added or a cover letter (true), has neither (false), or either (null). */
  material: boolean | null;
  /** A company's slug, or null for every company. */
  company: string | null;
  /** One-based. */
  page: number;
};

export const EXCITEMENT_MINIMUMS = [5, 4, 3] as const;

/** `yes` is true, `no` is false, anything else is no filter. */
function parseYesNo(value: string | undefined): boolean | null {
  return value === 'yes' ? true : value === 'no' ? false : null;
}

export function parsePipeline(params: PipelineParams): PipelineState {
  const scope: PipelineScope =
    params.status === 'closed' || params.status === 'all' ? params.status : 'live';
  // Focus and the board are the live applications; asking either for the
  // closed ones means the table, which is where they are kept.
  const view: PipelineViewName =
    params.view === 'table' || scope !== 'live' ? 'table' : params.view === 'board' ? 'board' : 'focus';
  const excitement = Number(params.excitement);
  const sent = Number(params.sent);
  return {
    stage: PIPELINE_STAGES.find((stage) => stage.key === params.stage) ?? null,
    sentDays: Number.isInteger(sent) && sent >= 1 && sent <= SENT_MAX_DAYS ? sent : null,
    ready: parseYesNo(params.ready),
    questions: parseYesNo(params.questions),
    letter: parseYesNo(params.letter),
    material: parseYesNo(params.material),
    company: params.company?.trim() || null,
    view,
    scope,
    source: APPLICATION_SOURCES.find((s) => s === params.source) ?? null,
    excitement: (EXCITEMENT_MINIMUMS as readonly number[]).includes(excitement) ? excitement : null,
    minimum: parseScoreMinimum(params),
    terms: searchTerms(params.q),
    page: parsePage(params.page),
  };
}

/** Whether a row is in the scope, by the one live rule (lib/jobs/pipeline.ts). */
export function inScope(row: Pick<PipelineRow, 'status'>, scope: PipelineScope): boolean {
  if (scope === 'all') return true;
  return scope === 'live' ? isLive(row.status) : !isLive(row.status);
}

/** One of the filters on the page, so a count can leave its own filter out. */
export type PipelineFacet =
  | 'status'
  | 'source'
  | 'company'
  | 'ready'
  | 'questions'
  | 'letter'
  | 'material';

/**
 * Whether a row passes every filter but the scope, and but `except` if named.
 * `status` is the scope and the stage together, which one menu sets.
 */
function passesFilters(
  row: PipelineRow,
  state: PipelineState,
  now: Date,
  except?: PipelineFacet,
): boolean {
  return (
    (except === 'source' || !state.source || row.source === state.source) &&
    (except === 'company' || !state.company || row.companySlug === state.company) &&
    (except === 'status' ||
      !state.stage || (state.stage.statuses as readonly ApplicationStatus[]).includes(row.status)) &&
    (state.sentDays === null || sentWithin(row, state.sentDays, now)) &&
    (except === 'ready' || state.ready === null || row.readyToApply === state.ready) &&
    (except === 'questions' || state.questions === null || row.allQuestionsAdded === state.questions) &&
    // Only an answer of no is without a letter: an unanswered role is in neither list.
    (except === 'letter' || state.letter === null || row.hasCoverLetter === state.letter) &&
    (except === 'material' || state.material === null || hasMaterial(row) === state.material) &&
    (!state.excitement || (row.excitement ?? 0) >= state.excitement) &&
    // A row not scored passes, as an unscored opening passes the openings' filters.
    passesMinimum(row.scoreNote, state.minimum) &&
    (state.terms.length === 0 || matchesSearch([row.companyName, row.roleTitle], state.terms))
  );
}

/** The rows in scope, and those of them every other filter lets through. */
export function filterPipeline(
  rows: readonly PipelineRow[],
  state: PipelineState,
  now: Date = new Date(),
): { scoped: PipelineRow[]; filtered: PipelineRow[] } {
  const scoped = rows.filter((row) => inScope(row, state.scope));
  const filtered = scoped.filter((row) => passesFilters(row, state, now));
  return { scoped, filtered };
}

/**
 * The number beside each choice in the filters: how many rows choosing it
 * would show, given every other filter already set (note d7af5bd8). A
 * filter's own choice is left out of its count, so its other options still
 * say what switching to them would show rather than zero.
 */
export function pipelineCounts(
  rows: readonly PipelineRow[],
  state: PipelineState,
  now: Date = new Date(),
) {
  const facet = (except: PipelineFacet) =>
    rows.filter(
      (row) => (except === 'status' || inScope(row, state.scope)) && passesFilters(row, state, now, except),
    );
  const count = (list: readonly PipelineRow[], test: (row: PipelineRow) => boolean) =>
    list.filter(test).length;

  const anyStatus = facet('status');
  const live = anyStatus.filter((row) => isLive(row.status));
  const stages = Object.fromEntries(
    PIPELINE_STAGES.map((stage) => [
      stage.key,
      count(live, (row) => (stage.statuses as readonly ApplicationStatus[]).includes(row.status)),
    ]),
  ) as Record<PipelineStageKey, number>;

  const sources = new Map<ApplicationSource, number>();
  for (const row of facet('source')) sources.set(row.source, (sources.get(row.source) ?? 0) + 1);

  const ready = facet('ready');
  const questions = facet('questions');
  const letter = facet('letter');
  const material = facet('material');

  return {
    status: { live: live.length, closed: anyStatus.length - live.length, all: anyStatus.length, stages },
    sources,
    /** The rows every filter but the company lets through, for the Company menu. */
    companyRows: facet('company'),
    marks: {
      ready: count(ready, (row) => row.readyToApply),
      notReady: count(ready, (row) => !row.readyToApply),
      questions: count(questions, (row) => row.allQuestionsAdded),
      noQuestions: count(questions, (row) => !row.allQuestionsAdded),
      letter: count(letter, (row) => row.hasCoverLetter === true),
      noLetter: count(letter, (row) => row.hasCoverLetter === false),
      material: count(material, hasMaterial),
      noMaterial: count(material, (row) => !hasMaterial(row)),
    },
  };
}

export type PipelineCounts = ReturnType<typeof pipelineCounts>;

/**
 * Whether anything has been put into the application yet: a question added,
 * or the cover letter answered yes. An unanswered letter counts as none.
 */
export function hasMaterial(row: Pick<PipelineRow, 'hasQuestions' | 'hasCoverLetter'>): boolean {
  return row.hasQuestions || row.hasCoverLetter === true;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether it was sent within `days` of `now`. An application created from its
 * confirmation email can carry the confirmation's time and no separate send
 * time; that is when it was sent. The same rule as Today's "Sent in the last
 * 7 days" (lib/jobs/home/summary.ts), so the number and the list agree.
 */
export function sentWithin(
  row: Pick<PipelineRow, 'submittedAt' | 'confirmationReceivedAt'>,
  days: number,
  now: Date,
): boolean {
  const sent = row.submittedAt ?? row.confirmationReceivedAt;
  if (!sent) return false;
  const at = new Date(sent).getTime();
  return Number.isFinite(at) && at >= now.getTime() - days * DAY_MS && at <= now.getTime();
}

const PIPELINE_ADDRESS: PageAddress<PipelineParams> = {
  path: PIPELINE_PATH,
  // The defaults stay out of the address, so the bare page is the bare link.
  defaults: { view: 'focus', status: 'live' },
};

/**
 * The link that changes `changes` and keeps everything else, going back to
 * the first page unless the page is what changes (lib/table-view.ts).
 */
export function pipelineHref(
  params: PipelineParams,
  changes: Partial<Record<keyof PipelineParams, string | undefined>>,
): string {
  return addressHref(PIPELINE_ADDRESS, params, changes);
}

/** Where an old /jobs/roles link lands: the table, with what it asked for. */
export function rolesRedirect(params: PipelineParams): string {
  return pipelineHref(params, { view: 'table' });
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

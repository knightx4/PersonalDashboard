import type { Seniority } from './scores';

/**
 * How past applications to similar roles went (plan #1202).
 *
 * Jev's chance score reads this beside the opening's text, so the estimate of
 * reaching an interview rests on what happened to applications like it and
 * not on the wording alone. "Chance" means the chance of an interview (#1201).
 *
 * Pure, so the summary can be tested and reused: #1203 scores open
 * applications the same way and passes the application's own id as
 * `excludeId`, so it is not counted as history for itself.
 */

/** One application on file, as the history reads it. */
export type PastApplication = {
  id: string;
  title: string;
  company: string | null;
  status: string;
  /** The override when set, else the stage the pipeline worked out. */
  rejectionStage: string | null;
  /** Whether any interview row is on file for it. */
  hasInterview: boolean;
};

/** Statuses that mean nothing was sent, so they are not history. */
const NOT_SENT = new Set(['lead', 'drafting']);

/** Statuses that mean the application got past the screen. */
const INTERVIEW_STATUSES = new Set(['in_process', 'final_round', 'offer']);

/** Rejection stages that come after a first conversation with someone. */
const INTERVIEW_STAGES = new Set(['recruiter_screen', 'hiring_manager', 'technical', 'onsite', 'final', 'offer_stage']);

/** Statuses still waiting on a reply, neither an interview nor a no. */
const WAITING = new Set(['submitted', 'acknowledged']);

/** Whether an application reached an interview: an interview on file, a later status, or a rejection after a screen. */
export function reachedInterview(app: PastApplication): boolean {
  if (app.hasInterview) return true;
  if (INTERVIEW_STATUSES.has(app.status)) return true;
  return app.rejectionStage !== null && INTERVIEW_STAGES.has(app.rejectionStage);
}

const LEVEL_RANK: Record<Seniority, number> = { entry: 0, mid: 1, senior: 2, executive: 3 };

/**
 * The level a title reads as, on the same four steps as the seniority
 * question. A title with no level word is taken as mid level.
 */
export function titleLevel(title: string): Seniority {
  const t = ` ${title.toLowerCase().replace(/[^a-z]+/g, ' ')} `;
  if (/ (director|vp|vice president|chief|cfo|coo|ceo|controller|head of finance) /.test(t)) return 'executive';
  if (/ (head|lead|principal|staff) /.test(t) || / senior manager /.test(t)) return 'senior';
  if (/ (senior|sr) /.test(t) && / (associate|analyst|specialist|accountant) /.test(t)) return 'mid';
  if (/ (manager|consultant) /.test(t)) return 'mid';
  if (/ (senior|sr) /.test(t)) return 'senior';
  if (/ (analyst|associate|specialist|coordinator|junior|jr|intern|assistant|accountant) /.test(t)) return 'entry';
  return 'mid';
}

/** Words that say the level, the employment terms or nothing, and so say nothing about the kind of work. */
const NOT_THE_WORK = new Set([
  'a', 'an', 'and', 'at', 'for', 'in', 'of', 'on', 'the', 'to', 'with', 'i', 'ii', 'iii', 'iv',
  'senior', 'sr', 'junior', 'jr', 'associate', 'analyst', 'specialist', 'coordinator', 'intern',
  'assistant', 'manager', 'director', 'vp', 'vice', 'president', 'head', 'lead', 'principal', 'staff',
  'chief', 'officer', 'consultant', 'remote', 'hybrid', 'contract', 'temporary', 'full', 'part', 'time',
]);

/**
 * The stems naming the kind of work in a title: level words dropped, each
 * word cut to its first six letters so "finance" and "financial", or
 * "strategy" and "strategic", meet.
 */
export function workStems(title: string): Set<string> {
  const stems = new Set<string>();
  for (const word of title.toLowerCase().split(/[^a-z]+/)) {
    if (word.length < 2 || NOT_THE_WORK.has(word)) continue;
    stems.add(word.slice(0, 6));
  }
  return stems;
}

/** Similar: at least one stem of the work in common, and a level no more than one step apart. */
export function isSimilarTitle(a: string, b: string): boolean {
  if (Math.abs(LEVEL_RANK[titleLevel(a)] - LEVEL_RANK[titleLevel(b)]) > 1) return false;
  const stems = workStems(b);
  for (const stem of workStems(a)) if (stems.has(stem)) return true;
  return false;
}

/** How a set of applications went. */
export type HistoryCounts = {
  applied: number;
  reached_an_interview: number;
  /** Sent and not yet answered either way. */
  still_waiting: number;
};

/** What Jev is told: the similar ones with a few examples, and the whole record for a baseline. */
export type HistorySummary = {
  similar: HistoryCounts & { examples: string[] };
  all_applications: HistoryCounts;
};

/** How many similar applications Jev reads by name. */
export const HISTORY_EXAMPLES = 12;

function counts(apps: PastApplication[]): HistoryCounts {
  return {
    applied: apps.length,
    reached_an_interview: apps.filter(reachedInterview).length,
    still_waiting: apps.filter((app) => !reachedInterview(app) && WAITING.has(app.status)).length,
  };
}

function outcome(app: PastApplication): string {
  if (reachedInterview(app)) return 'reached an interview';
  if (WAITING.has(app.status)) return 'no reply yet';
  if (app.status === 'rejected' && app.rejectionStage && app.rejectionStage !== 'unknown') {
    return `rejected at ${app.rejectionStage.replace(/_/g, ' ')}`;
  }
  return app.status.replace(/_/g, ' ');
}

/**
 * The history for one title. `history` is newest first; the examples keep
 * that order and put the ones that reached an interview first, since those
 * are the few that say what worked.
 */
export function summariseHistory(
  title: string,
  history: readonly PastApplication[],
  options: { excludeId?: string } = {},
): HistorySummary {
  const sent = history.filter((app) => !NOT_SENT.has(app.status) && app.id !== options.excludeId);
  const similar = sent.filter((app) => isSimilarTitle(title, app.title));
  const ordered = [...similar.filter(reachedInterview), ...similar.filter((app) => !reachedInterview(app))];
  return {
    similar: {
      ...counts(similar),
      examples: ordered
        .slice(0, HISTORY_EXAMPLES)
        .map((app) => `${app.title} at ${app.company ?? 'an unnamed company'}: ${outcome(app)}`),
    },
    all_applications: counts(sent),
  };
}

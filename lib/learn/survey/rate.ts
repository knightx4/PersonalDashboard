import type { SurveyPool } from './pick';

/**
 * How often Practice Flow asks about a vault subject that is not a track
 * (plan #842, decision #839).
 *
 * The rate depends on how much of what you write about has been tested. Only
 * the fields you write about count, meaning the fields with a theme placed in
 * them:
 *
 * - While any of those fields has no answered question, in a track or in the
 *   survey, one question in two is a survey question.
 * - Once every field has at least one, the rate tapers with the share of
 *   fields that still have fewer than `FEW` answered survey questions. A field
 *   a track has tested counts as having enough.
 * - Once every field has `FEW`, one question in five.
 *
 * The rate becomes a cadence in `surveySlots`: at one in n, a survey question
 * is written when none of the last n - 1 flow questions was one. So the rates
 * that come out are one in two, three, four or five.
 *
 * Pure, so it can be tested without a database.
 */

/** The rate while some field you write about is untested. */
export const SURVEY_MOST = 1 / 2;
/** The rate once every field you write about has `FEW` answers. */
export const SURVEY_LEAST = 1 / 5;
/** How many answered survey questions make a field no longer need surveying. */
export const FEW = 3;
/** How many recent flow questions the cadence reads: n - 1 at the lowest rate. */
export const SURVEY_LOOKBACK = Math.round(1 / SURVEY_LEAST) - 1;

/** One field you write about, and what has been answered in it. */
export type SurveyField = {
  /** Answered survey questions about themes in the field. */
  answered: number;
  /** Whether a track placed in the field has an answered question. */
  trackTested: boolean;
};

/** The fields you write about, from the survey's pool. */
export function fieldsWrittenAbout(
  pool: Pick<SurveyPool, 'themes' | 'trackTestedFields' | 'counts'>,
): SurveyField[] {
  const ids = new Set(pool.themes.map((theme) => theme.fieldId));
  return [...ids].map((id) => ({
    answered: pool.counts.byField.get(id)?.answered ?? 0,
    trackTested: pool.trackTestedFields.has(id),
  }));
}

/**
 * The share of flow questions that should be survey questions, between
 * `SURVEY_LEAST` and `SURVEY_MOST`. Zero with no fields, since then there is
 * nothing to survey.
 */
export function surveyShare(fields: readonly SurveyField[]): number {
  if (fields.length === 0) return 0;
  if (fields.some((field) => !field.trackTested && field.answered === 0)) return SURVEY_MOST;
  const short = fields.filter((field) => !field.trackTested && field.answered < FEW).length;
  return SURVEY_LEAST + (SURVEY_MOST - SURVEY_LEAST) * (short / fields.length);
}

/**
 * Which of the next `wanted` questions are survey questions, in order.
 *
 * `recent` says, newest first, whether each of the flow's latest questions was
 * a survey question: the ones waiting, the one on the screen and the ones
 * answered. At one in n, a slot is a survey question when none of the n - 1
 * questions before it was.
 */
export function surveySlots(recent: readonly boolean[], share: number, wanted: number): boolean[] {
  if (share <= 0) return Array.from({ length: Math.max(wanted, 0) }, () => false);
  const every = Math.max(1, Math.round(1 / share));
  const seen = [...recent];
  const slots: boolean[] = [];
  for (let i = 0; i < wanted; i += 1) {
    const survey = !seen.slice(0, every - 1).includes(true);
    slots.push(survey);
    seen.unshift(survey);
  }
  return slots;
}

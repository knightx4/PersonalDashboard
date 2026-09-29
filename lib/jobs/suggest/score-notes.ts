import { CHANCE_BAND_LABELS, CHANCE_DISPLAY, type ChanceBand } from './chance-check';
import { chanceReason, fitReason, type ScoreReasonInput } from './reasons';
import { SCORE_CONFIDENCE_FLOOR, chanceBandOf, reachesBand } from './scores';

/**
 * Fit and chance as a list row shows them (plan #1206): the figure, whether
 * Jev was under the confidence floor, and the one-line reason from
 * reasons.ts. Built on the server, where the history is, so the client gets
 * a few strings per row rather than every past application.
 *
 * Chance keeps its stored 0 to 100 value for sorting and filtering, and shows
 * as its band while CHANCE_DISPLAY says so (#1204: the number did not predict
 * interviews).
 */

export type ScoreFigure = { value: number; unsure: boolean; reason: string | null };

export type ScoreNote = {
  fit: ScoreFigure | null;
  chance: (ScoreFigure & { band: ChanceBand }) | null;
};

/** The chance bands, lowest first, as the minimum filter offers them. */
export const CHANCE_BANDS: readonly ChanceBand[] = ['low', 'medium', 'high'];

/** How the chance figure reads: its band while chance shows as one, else the number. */
export function chanceText(chance: { value: number; band: ChanceBand }): string {
  return CHANCE_DISPLAY.kind === 'band' ? CHANCE_BAND_LABELS[chance.band] : String(chance.value);
}

/**
 * Both figures for one row, or null when neither was scored. Chance is left
 * out where the application has already reached an interview: the chance of
 * one is moot there.
 */
export function scoreNote(input: ScoreReasonInput, options: { interviewed?: boolean } = {}): ScoreNote | null {
  const { fit_score: fit, chance } = input.scores;
  const note: ScoreNote = {
    fit: fit ? { value: fit.value, unsure: fit.confidence < SCORE_CONFIDENCE_FLOOR, reason: fitReason(input) } : null,
    chance:
      chance && !options.interviewed
        ? {
            value: chance.value,
            band: chanceBandOf(chance.value),
            unsure: chance.confidence < SCORE_CONFIDENCE_FLOOR,
            reason: chanceReason(input),
          }
        : null,
  };
  return note.fit || note.chance ? note : null;
}

/** The minimums a list can be narrowed by. Zero and 'any' narrow nothing. */
export type ScoreMinimum = { fit: number; chance: ChanceBand | 'any' };

export const NO_SCORE_MINIMUM: ScoreMinimum = { fit: 0, chance: 'any' };

/** The fit minimums offered, as the figure a row must reach. */
export const FIT_MINIMUMS = [40, 50, 60, 70] as const;

/**
 * Whether a row clears the minimums. A row with no figure for a minimum
 * passes it, as an unscored opening passes every filter.
 */
export function passesMinimum(note: ScoreNote | null | undefined, minimum: ScoreMinimum): boolean {
  if (minimum.fit > 0 && note?.fit && note.fit.value < minimum.fit) return false;
  if (note?.chance && !reachesBand(note.chance.value, minimum.chance)) return false;
  return true;
}

/** Highest first; a row without the figure sorts last. For a comparator: `rank(b) - rank(a)`. */
export function noteRank(note: ScoreNote | null | undefined, which: 'fit' | 'chance'): number {
  return note?.[which]?.value ?? -1;
}

/** A minimum read off the URL: `minfit=60`, `minchance=medium`. Anything else is no minimum. */
export function parseScoreMinimum(params: { minfit?: string; minchance?: string }): ScoreMinimum {
  const fit = Number(params.minfit);
  return {
    fit: (FIT_MINIMUMS as readonly number[]).includes(fit) ? fit : 0,
    chance: CHANCE_BANDS.find((band) => band === params.minchance) ?? 'any',
  };
}

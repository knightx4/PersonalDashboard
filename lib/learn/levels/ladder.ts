/**
 * The ten levels every topic shares (docs/LEARN-LEVELS-SPEC.md, "The ten
 * levels"): what you can do at each, and the band it sits in.
 *
 * One list for the drafting prompt, the draft page and the topic page, so the
 * wording a descriptor is drafted against is the wording the person reads
 * beside it.
 */

export const BANDS = ['Aware', 'Working', 'Fluent', 'Expert'] as const;
export type Band = (typeof BANDS)[number];

export type LadderLevel = {
  level: number;
  band: Band;
  /** What you can do at this level, as the spec's table puts it. */
  can: string;
};

export const LADDER: readonly LadderLevel[] = [
  { level: 1, band: 'Aware', can: 'place it: what field it is in, what it is for' },
  { level: 2, band: 'Aware', can: 'define it accurately in your own words' },
  { level: 3, band: 'Working', can: 'explain how it works: each part and why it is there' },
  { level: 4, band: 'Working', can: 'do it on a clean, given case' },
  { level: 5, band: 'Working', can: 'do it on a real case, choosing the inputs yourself' },
  { level: 6, band: 'Fluent', can: 'judge the output: what drives it, whether it is sane' },
  { level: 7, band: 'Fluent', can: 'name its limits: assumptions, failure modes, what to use instead' },
  { level: 8, band: 'Fluent', can: 'connect it: derive it, relate it to neighbouring topics' },
  { level: 9, band: 'Expert', can: 'use the moves practitioners use that most people do not know' },
  { level: 10, band: 'Expert', can: 'argue its live disputes and defend a position against the strongest objection' },
];

/** The ladder's entry for a level, which must be 1 to 10. */
export function ladderLevel(level: number): LadderLevel {
  const found = LADDER[level - 1];
  if (!found) throw new Error(`No level ${level} on the ladder.`);
  return found;
}

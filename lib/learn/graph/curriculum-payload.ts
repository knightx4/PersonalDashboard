import { z } from 'zod';

/**
 * Reading a curriculum the model reported (LEARN-GRAPH-SPEC, "The
 * curriculum"). Pure, so the rules are tested without a model.
 */

/**
 * A new track's first units (LEARN-LESSONS-SPEC, "Units are written as you
 * go"). The rest are written one at a time as these are finished.
 */
export const FIRST_UNITS_MIN = 3;
export const FIRST_UNITS_MAX = 4;
/** Units a person may write for a track of their own, which are kept whole. */
export const MAX_UNITS = 12;

const MAX_TITLE = 80;
const MAX_TEXT = 400;

export type CurriculumUnit = { title: string; covers: string; outcome: string };

export type CurriculumResult =
  | {
      ok: true;
      units: CurriculumUnit[];
      /** Index into `units`, or null. */
      goalUnit: number | null;
    }
  | { ok: false; detail: string };

const payloadSchema = z.object({
  units: z.array(z.object({ title: z.string(), covers: z.string(), outcome: z.string() })),
  goal_unit: z.number().int().nullable().optional(),
});

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The first units, cleaned. A unit missing any of its three parts, or
 * repeating a title already used, is left out; past FIRST_UNITS_MAX the rest
 * are cut. Fewer than FIRST_UNITS_MIN left is a failure, and the track is
 * better left to ask again than started on one or two units.
 *
 * `goal_unit` counts from 1 over what the model sent. It is mapped to the unit
 * kept at that place, and dropped when that unit was left out.
 *
 * With `fixed`, the person wrote the units themselves: their titles and their
 * order are kept whatever the model sent, and the model's covers and outcome
 * are matched to them by place. A unit the model wrote nothing for keeps an
 * empty line rather than being dropped, since the person asked for it.
 */
export function readCurriculum(input: unknown, fixed?: readonly string[]): CurriculumResult {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, detail: 'The curriculum did not match its schema.' };

  if (fixed && fixed.length > 0) {
    const units = fixed.slice(0, MAX_UNITS).map((title, index) => {
      const written = parsed.data.units[index];
      const covers = written ? clean(written.covers) : '';
      const outcome = written ? clean(written.outcome) : '';
      return {
        title,
        covers: covers.length <= MAX_TEXT ? covers : '',
        outcome: outcome.length <= MAX_TEXT ? outcome : '',
      };
    });
    const goal = parsed.data.goal_unit;
    const goalUnit = goal && goal >= 1 && goal <= units.length ? goal - 1 : null;
    return { ok: true, units, goalUnit };
  }

  const units: CurriculumUnit[] = [];
  const seen = new Set<string>();
  let goalUnit: number | null = null;
  parsed.data.units.forEach((raw, index) => {
    const title = clean(raw.title);
    const covers = clean(raw.covers);
    const outcome = clean(raw.outcome);
    const key = title.toLowerCase();
    if (!title || !covers || !outcome || seen.has(key) || units.length === FIRST_UNITS_MAX) return;
    if (title.length > MAX_TITLE || covers.length > MAX_TEXT || outcome.length > MAX_TEXT) return;
    seen.add(key);
    if (parsed.data.goal_unit === index + 1) goalUnit = units.length;
    units.push({ title, covers, outcome });
  });

  if (units.length < FIRST_UNITS_MIN) {
    return { ok: false, detail: `The curriculum came back with ${units.length} usable units.` };
  }
  return { ok: true, units, goalUnit };
}

export type NextUnitResult = { ok: true; unit: CurriculumUnit } | { ok: false; detail: string };

const nextUnitSchema = z.object({ title: z.string(), covers: z.string(), outcome: z.string() });

/**
 * The one unit written after a track's last (LEARN-LESSONS-SPEC, "Units are
 * written as you go"), cleaned by the same rules as the first units. A title
 * the track already has is refused, since the unit would repeat one.
 */
export function readNextUnit(input: unknown, existingTitles: readonly string[]): NextUnitResult {
  const parsed = nextUnitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, detail: 'The unit did not match its schema.' };
  const title = clean(parsed.data.title);
  const covers = clean(parsed.data.covers);
  const outcome = clean(parsed.data.outcome);
  if (!title || !covers || !outcome) return { ok: false, detail: 'The unit came back with a part missing.' };
  if (title.length > MAX_TITLE || covers.length > MAX_TEXT || outcome.length > MAX_TEXT) {
    return { ok: false, detail: 'The unit came back too long.' };
  }
  if (existingTitles.some((existing) => existing.trim().toLowerCase() === title.toLowerCase())) {
    return { ok: false, detail: `The unit repeats "${title}", which the track already has.` };
  }
  return { ok: true, unit: { title, covers, outcome } };
}

/**
 * The units a person wrote, one per line, as the form sends them. Bullets and
 * numbering are taken off, blank lines and repeats dropped.
 */
export function parseOwnUnits(
  text: string,
): { ok: true; titles: string[] } | { ok: false; detail: string } {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const title = clean(line.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, ''));
    if (!title || seen.has(title.toLowerCase())) continue;
    if (title.length > MAX_TITLE)
      return { ok: false, detail: `"${title.slice(0, 40)}…" is too long for a unit title.` };
    seen.add(title.toLowerCase());
    titles.push(title);
  }
  if (titles.length > MAX_UNITS)
    return { ok: false, detail: `A curriculum holds at most ${MAX_UNITS} units.` };
  return { ok: true, titles };
}

/** What a unit's chain is asked for, when it is opened. */
export function unitGoal(unit: Pick<CurriculumUnit, 'title' | 'outcome'>): string {
  const text = unit.outcome ? `${unit.title}: ${unit.outcome}` : unit.title;
  return text.length > 300 ? text.slice(0, 299) : text;
}

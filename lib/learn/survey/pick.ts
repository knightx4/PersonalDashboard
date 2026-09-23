/**
 * Which vault theme the next survey question is about (plan #841).
 *
 * The survey asks about subjects you write about and have no track for, and it
 * spreads its questions across fields rather than drawing them all from your
 * strongest theme. A field where nothing has been answered yet comes first,
 * whether the answer would be in a track or in the survey. Among those, the
 * field with the fewest survey questions written so far goes next, so each
 * question written moves the next one on to another field. Within a field, the
 * theme asked about least goes first, then the strongest.
 *
 * Pure, so the spreading can be tested without a database. The rows are read
 * in `load.ts`.
 */

/** How many themes one call to the writer tries before giving up. */
export const SURVEY_TRIES = 3;

/** A vault theme placed in a field. */
export type SurveyTheme = {
  id: string;
  name: string;
  strength: number;
  fieldId: string;
  /** Whether any note is linked to it. A theme with none has nothing to ask. */
  hasNotes: boolean;
};

/** Survey questions written and answered, for one field or one theme. */
export type SurveyCount = {
  asked: number;
  answered: number;
  /**
   * When the latest of those answers was given. Set by `tallySurvey` when the
   * probes it was given carry their answer times, for the Know grid's date.
   */
  lastAnswered?: string;
};

export type SurveyCounts = {
  byField: Map<string, SurveyCount>;
  byTheme: Map<string, SurveyCount>;
};

/** Everything the pick reads. */
export type SurveyPool = {
  themes: SurveyTheme[];
  fieldNames: ReadonlyMap<string, string>;
  /** Themes a real track was made from (`learn.subjects.theme_id`, not survey). */
  trackThemeIds: ReadonlySet<string>;
  /** Every real track's name. A theme with a track's name is that track's. */
  trackNames: readonly string[];
  /** Fields with a placed track that has an answered question. */
  trackTestedFields: ReadonlySet<string>;
  counts: SurveyCounts;
};

export type SurveyCandidate = {
  themeId: string;
  themeName: string;
  fieldId: string;
  fieldName: string;
};

const key = (name: string) => name.trim().toLowerCase();
const none: SurveyCount = { asked: 0, answered: 0 };

/** Whether a field has any answered question, in a track or in the survey. */
export function fieldAnswered(
  fieldId: string,
  pool: Pick<SurveyPool, 'trackTestedFields' | 'counts'>,
): boolean {
  return (
    pool.trackTestedFields.has(fieldId) || (pool.counts.byField.get(fieldId) ?? none).answered > 0
  );
}

/**
 * The themes to try, in order, at most `limit` of them.
 *
 * One theme from each field in field order, then a second from each, and so
 * on, so a theme that cannot be asked about hands over to another field rather
 * than to its neighbour. A theme is left out when it is a track, by id or by
 * name, when no note is linked to it, or when it is in `skip`.
 */
export function surveyCandidates(
  pool: SurveyPool,
  limit: number = SURVEY_TRIES,
  skip: ReadonlySet<string> = new Set(),
): SurveyCandidate[] {
  const tracked = new Set(pool.trackNames.map(key));
  const open = pool.themes.filter(
    (theme) =>
      theme.hasNotes &&
      pool.fieldNames.has(theme.fieldId) &&
      !skip.has(theme.id) &&
      !pool.trackThemeIds.has(theme.id) &&
      !tracked.has(key(theme.name)),
  );

  const asked = (theme: SurveyTheme) => (pool.counts.byTheme.get(theme.id) ?? none).asked;
  const inField = new Map<string, SurveyTheme[]>();
  for (const theme of open) {
    const list = inField.get(theme.fieldId) ?? [];
    list.push(theme);
    inField.set(theme.fieldId, list);
  }
  for (const list of inField.values()) {
    list.sort(
      (a, b) => asked(a) - asked(b) || b.strength - a.strength || a.name.localeCompare(b.name),
    );
  }

  const fieldName = (id: string) => pool.fieldNames.get(id) ?? '';
  const summed = (id: string) => inField.get(id)!.reduce((sum, theme) => sum + theme.strength, 0);
  const fields = [...inField.keys()]
    .map((id) => ({
      id,
      untested: !fieldAnswered(id, pool),
      asked: (pool.counts.byField.get(id) ?? none).asked,
      strength: summed(id),
    }))
    .sort(
      (a, b) =>
        Number(b.untested) - Number(a.untested) ||
        a.asked - b.asked ||
        b.strength - a.strength ||
        fieldName(a.id).localeCompare(fieldName(b.id)),
    );

  const picked: SurveyCandidate[] = [];
  for (let round = 0; picked.length < limit; round += 1) {
    let any = false;
    for (const field of fields) {
      const theme = inField.get(field.id)![round];
      if (!theme) continue;
      any = true;
      picked.push({
        themeId: theme.id,
        themeName: theme.name,
        fieldId: field.id,
        fieldName: fieldName(field.id),
      });
      if (picked.length === limit) break;
    }
    if (!any) break;
  }
  return picked;
}

/**
 * Count survey questions per theme and per field.
 *
 * A question counts as asked once it is written, whether or not it has been
 * shown, so questions waiting in a queue move the next pick on as well. It
 * counts as answered once it has an answer. A theme not placed in a field is
 * counted by theme and left out of the fields.
 */
export function tallySurvey(input: {
  /** Survey subjects and the theme each is about. */
  subjects: { id: string; themeId: string }[];
  /** Each theme's field, from `learn.theme_fields`. */
  placements: ReadonlyMap<string, string>;
  concepts: { id: string; subjectId: string }[];
  /** Survey questions not thrown away. */
  probes: { conceptId: string; answered: boolean; answeredAt?: string | null }[];
}): SurveyCounts {
  const themeOfSubject = new Map(input.subjects.map((subject) => [subject.id, subject.themeId]));
  const themeOfConcept = new Map<string, string>();
  for (const concept of input.concepts) {
    const themeId = themeOfSubject.get(concept.subjectId);
    if (themeId) themeOfConcept.set(concept.id, themeId);
  }

  const byField = new Map<string, SurveyCount>();
  const byTheme = new Map<string, SurveyCount>();
  type Probe = (typeof input.probes)[number];
  const add = (map: Map<string, SurveyCount>, id: string, probe: Probe) => {
    const count = map.get(id) ?? { asked: 0, answered: 0 };
    count.asked += 1;
    if (probe.answered) count.answered += 1;
    const at = probe.answered ? probe.answeredAt : null;
    if (at && (!count.lastAnswered || Date.parse(at) > Date.parse(count.lastAnswered))) {
      count.lastAnswered = at;
    }
    map.set(id, count);
  };

  for (const probe of input.probes) {
    const themeId = themeOfConcept.get(probe.conceptId);
    if (!themeId) continue;
    add(byTheme, themeId, probe);
    const fieldId = input.placements.get(themeId);
    if (fieldId) add(byField, fieldId, probe);
  }
  return { byField, byTheme };
}

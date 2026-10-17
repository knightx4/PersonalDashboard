/**
 * Counting the survey questions already asked (plan #841), for the Know grid
 * and the track offer. The survey that wrote them, and the pick of which theme
 * to ask about next, were retired by plan #2313.2; the counts stay so the
 * answers given before still show.
 *
 * Pure, so the tally can be tested without a database. The rows are read in
 * `load.ts`.
 */

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

/**
 * Count survey questions per theme and per field.
 *
 * A question counts as asked once it is written, whether or not it has been
 * shown, so questions waiting in a queue move the next pick on as well. It
 * counts as answered once it has an answer. A theme not placed in a field is
 * counted by theme and left out of the fields.
 *
 * A goal's survey subject (plan #1385) has no theme. Its questions count in
 * the goal's field, given as `goalFieldId`, so a field tested only through a
 * goal question reads as tested on the Know grid, as a theme answer does.
 */
export function tallySurvey(input: {
  /**
   * Survey subjects and the theme each is about, or for a goal's subject the
   * goal's field (null when the goal is not placed in one).
   */
  subjects: { id: string; themeId: string | null; goalFieldId?: string | null }[];
  /** Each theme's field, from `learn.theme_fields`. */
  placements: ReadonlyMap<string, string>;
  concepts: { id: string; subjectId: string }[];
  /** Survey questions not thrown away. */
  probes: { conceptId: string; answered: boolean; answeredAt?: string | null }[];
}): SurveyCounts {
  const subjectOf = new Map(input.subjects.map((subject) => [subject.id, subject]));
  const themeOfConcept = new Map<string, string>();
  const goalFieldOfConcept = new Map<string, string>();
  for (const concept of input.concepts) {
    const subject = subjectOf.get(concept.subjectId);
    if (subject?.themeId) themeOfConcept.set(concept.id, subject.themeId);
    else if (subject?.goalFieldId) goalFieldOfConcept.set(concept.id, subject.goalFieldId);
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
    const goalFieldId = goalFieldOfConcept.get(probe.conceptId);
    if (goalFieldId) add(byField, goalFieldId, probe);
    const themeId = themeOfConcept.get(probe.conceptId);
    if (!themeId) continue;
    add(byTheme, themeId, probe);
    const fieldId = input.placements.get(themeId);
    if (fieldId) add(byField, fieldId, probe);
  }
  return { byField, byTheme };
}

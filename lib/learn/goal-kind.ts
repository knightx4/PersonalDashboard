/**
 * The kind of a learning goal, which decides where its structure is looked for
 * (plan #2247.2).
 *
 * Before a territory is drafted, each goal is sorted into one of six kinds.
 * The kind maps in code to a list of providers, tried in order, and the grain
 * the structure is wanted at. Beekeeping never spends fifty requests on a
 * university form because its kind is `practical_skill`, whose providers are
 * extension courses and certification syllabi.
 *
 * Pure, so the goal's page and the server can both import it. The call that
 * chooses a kind is in goal-kind-call.ts; where it is kept is goal-kind-store.ts.
 */

export const GOAL_KINDS = [
  'academic_course',
  'research_subfield',
  'narrow_question',
  'institution',
  'practical_skill',
  'broad_field',
] as const;

export type GoalKind = (typeof GOAL_KINDS)[number];

export function isGoalKind(value: unknown): value is GoalKind {
  return typeof value === 'string' && (GOAL_KINDS as readonly string[]).includes(value);
}

/** Who chose a goal's kind: the classifying call, or the person changing it. */
export type GoalKindBy = 'model' | 'person';

export const KIND_REASON_MAX = 300;

/** What the page calls each kind, with the line that says what it covers. */
export const GOAL_KIND_LABELS: Record<GoalKind, { label: string; means: string }> = {
  academic_course: { label: 'Academic course', means: 'a subject universities teach as a course' },
  research_subfield: { label: 'Research subfield', means: 'a specialist area whose structure lives in papers and lecture notes' },
  narrow_question: { label: 'Narrow question', means: 'a question narrower than any course, answered from several sources' },
  institution: { label: 'Institution', means: 'how a body such as a central bank or a court works' },
  practical_skill: { label: 'Practical skill', means: 'something learned by doing, taught outside universities' },
  broad_field: { label: 'Broad field', means: 'a wide area covered at survey depth' },
};

/**
 * The sources a draft can pull structure from, by the id each provider step
 * uses. A kind may list an id whose code has not landed yet; the draft skips
 * what it cannot run.
 *
 *   ocw                   MIT OpenCourseWare calendars (#2247.3)
 *   ut_austin             UT Austin public syllabi (#2247.4)
 *   openstax              OpenStax tables of contents, structure only (#2247.8)
 *   arxiv                 arXiv lecture notes and reviews (#2247.5)
 *   monographs            monographs the model names, confirmed by fetch
 *   primary_sources       primary-source indexes from the allowlist (#2247.6)
 *   frame                 the Level 4 frame topics the app already holds
 *   official_explainers   official explainers from the allowlist (#2247.6)
 *   extension             cooperative extension short courses (#2247.7)
 *   certification         certification syllabi (#2247.7)
 *   yale                  Open Yale Courses lecture lists (#2247.9)
 */
export const PROVIDER_IDS = [
  'ocw',
  'ut_austin',
  'openstax',
  'arxiv',
  'monographs',
  'primary_sources',
  'frame',
  'official_explainers',
  'extension',
  'certification',
  'yale',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

/** How fine the structure wanted is, which a provider reads to choose what to keep. */
export type StructureGrain = 'week' | 'chapter' | 'section' | 'source' | 'lesson';

export type KindPlan = {
  /** Tried in this order. */
  providers: readonly ProviderId[];
  grain: StructureGrain;
};

export const KIND_PLANS: Record<GoalKind, KindPlan> = {
  academic_course: { providers: ['ocw', 'ut_austin', 'openstax', 'yale'], grain: 'week' },
  broad_field: { providers: ['ocw', 'ut_austin', 'openstax', 'yale'], grain: 'chapter' },
  research_subfield: { providers: ['arxiv', 'ocw'], grain: 'section' },
  narrow_question: { providers: ['monographs', 'primary_sources', 'frame'], grain: 'source' },
  institution: { providers: ['official_explainers'], grain: 'chapter' },
  practical_skill: { providers: ['extension', 'certification'], grain: 'lesson' },
};

/**
 * The providers a draft runs for a goal. A goal not yet classified runs none:
 * the kind is read first, so a draft never falls back to trying everything.
 */
export function providersForKind(kind: GoalKind | null | undefined): readonly ProviderId[] {
  return kind ? KIND_PLANS[kind].providers : [];
}

export function grainForKind(kind: GoalKind | null | undefined): StructureGrain | null {
  return kind ? KIND_PLANS[kind].grain : null;
}

/** What the classifying call reads of a goal. */
export type GoalToClassify = { name: string; about: string | null };

/** One reply entry, read: the number of the goal asked about, its kind and its reason. */
export type KindAnswer = { goal: number; kind: GoalKind; reason: string };

/**
 * Read the tool payload against the batch it answers. Pure, and exported for
 * the test. An entry is kept only when its number is one asked about, its kind
 * is one of the six and its reason is not empty; the first answer for a goal
 * wins. A goal left without an answer stays unclassified and is asked again on
 * the next save.
 */
export function readKinds(input: unknown, asked: number): KindAnswer[] {
  const list = (input as { kinds?: unknown } | null)?.kinds;
  if (!Array.isArray(list)) return [];
  const seen = new Set<number>();
  const out: KindAnswer[] = [];
  for (const entry of list) {
    const e = entry as { goal?: unknown; kind?: unknown; reason?: unknown } | null;
    const goal = typeof e?.goal === 'number' ? e.goal : NaN;
    const reason =
      typeof e?.reason === 'string' ? e.reason.replace(/\s+/g, ' ').trim().slice(0, KIND_REASON_MAX) : '';
    if (!Number.isInteger(goal) || goal < 1 || goal > asked || seen.has(goal)) continue;
    const kind = e?.kind;
    if (!isGoalKind(kind) || reason === '') continue;
    seen.add(goal);
    out.push({ goal, kind, reason });
  }
  return out;
}

/**
 * True when a goal needs the classifying call: it has no kind, or its kind is
 * the model's and was read from other wording than the goal has now. A kind the
 * person set is never stale.
 */
export function kindIsStale(aim: {
  kind: GoalKind | null;
  kindBy: GoalKindBy | null;
  kindReadName: string | null;
  kindReadAbout: string | null;
  name: string;
  about: string | null;
}): boolean {
  if (aim.kind === null) return true;
  if (aim.kindBy === 'person') return false;
  return aim.kindReadName !== aim.name || aim.kindReadAbout !== aim.about;
}

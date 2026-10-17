/**
 * A company's perspective: the person's own view of a company they want to
 * focus on, as six short answers on the company's Perspective tab
 * (migrations-job-search/0061). The same answers are the start of a cover
 * letter, the opening of an interview and the reason in a cold message, so
 * they are kept on the company, where every role there can reach them.
 *
 * The questions are listed once here, for the tab, the action that saves an
 * answer, the Targets view's count and Dash's change_company.
 */
export const PERSPECTIVE_QUESTIONS = [
  {
    key: 'business',
    column: 'perspective_business',
    label: 'What they do',
    prompt: 'What the company does and how it makes money, in your own words.',
  },
  {
    key: 'whyNow',
    column: 'perspective_why_now',
    label: 'Why now',
    prompt: 'Their stage, recent funding, what is changing for them, and where finance is being built.',
  },
  {
    key: 'problem',
    column: 'perspective_problem',
    label: 'The problem you would solve',
    prompt: 'The finance or strategy problem they will have in the next 12 to 18 months.',
  },
  {
    key: 'whyMe',
    column: 'perspective_why_me',
    label: 'Why you',
    prompt: 'Two or three specific things from your background that match that problem.',
  },
  {
    key: 'unknowns',
    column: 'perspective_unknowns',
    label: 'What you do not know yet',
    prompt: 'Risks and open questions. These are what you ask in your conversations.',
  },
  {
    key: 'nextMove',
    column: 'perspective_next_move',
    label: 'Next move',
    prompt: 'The one concrete thing to do next.',
  },
] as const;

export type PerspectiveKey = (typeof PERSPECTIVE_QUESTIONS)[number]['key'];

export type Perspective = Record<PerspectiveKey, string>;

/** The perspective columns, for a select. */
export const PERSPECTIVE_COLUMNS = [
  ...PERSPECTIVE_QUESTIONS.map((question) => question.column),
  'perspective_updated_at',
].join(', ');

/** The six answers on a company row, blank where there is none. */
export function perspectiveOf(row: Record<string, unknown>): Perspective {
  return Object.fromEntries(
    PERSPECTIVE_QUESTIONS.map((question) => [question.key, (row[question.column] as string | null) ?? '']),
  ) as Perspective;
}

/** How many of the six have an answer. */
export function answeredCount(perspective: Perspective): number {
  return PERSPECTIVE_QUESTIONS.filter((question) => perspective[question.key].trim() !== '').length;
}

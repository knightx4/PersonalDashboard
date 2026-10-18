import { FIGURE_KINDS, figureKind } from './registry';
import type { FigureBlock, FigureChoice, FigureKind, FigureQuestionForm, FigureQuestionVerdict, FigureResolveContext } from './types';

/**
 * Figure questions (plan #2321.5): a question that asks somebody to use a
 * figure rather than write a paragraph. The forms are listed on their kinds
 * (`FigureKind.questions`); this file is the part that names none of them:
 * the writer's list, posing what the writer wrote, the stored shape, what
 * the page is sent, and grading.
 *
 * A question is posed once, when it is asked, and stored whole on its
 * learn.cell_questions row: the figure as shown, the choices, and the
 * answer. A chart's numbers are fetched then and kept with it, so grading
 * never fetches and a question reads the same when it is shown again.
 */

/** One form on one kind, as the writer is offered it. */
export type FigureQuestionOffer = { kind: FigureKind; form: FigureQuestionForm };

/** Every form on every kind that carries one, in registry order. */
export function figureQuestionOffers(): FigureQuestionOffer[] {
  return FIGURE_KINDS.flatMap((kind) => (kind.questions ?? []).map((form) => ({ kind, form })));
}

export function figureQuestionOffer(kindId: string, formId: string): FigureQuestionOffer | null {
  const kind = figureKind(kindId);
  const form = kind?.questions?.find((each) => each.id === formId);
  return kind && form ? { kind, form } : null;
}

/** The writer's list: each form with the kind it is asked on and that kind's own shape. */
export function figureQuestionWriterLines(): string {
  return figureQuestionOffers()
    .map(({ kind, form }) => `- form "${form.id}" on kind "${kind.id}". ${form.writerLine}\n  The figure's spec: ${kind.writerLine}`)
    .join('\n');
}

/** What the question writer reports, before anything is checked. */
export type WrittenFigureQuestion = { kind: string; form: string; caption: string; spec: unknown; ask: unknown };

/** A figure question as `cell_questions.figure` stores it. Every figure in it is as shown. */
export type StoredFigureQuestion = {
  kind: string;
  form: string;
  caption: string;
  spec: unknown;
  resolved?: unknown;
  prompt: string;
  choices?: Array<{ value: string; label: string; spec?: unknown }>;
  answer: string;
};

/** What the page is sent: the question without its answer. */
export type FigureQuestionView = {
  /** The form's label, such as "Fill the cell". */
  label: string;
  figure: FigureBlock;
  prompt: string;
  /** Absent for a short typed answer. */
  choices?: FigureChoice[];
};

const MAX_CAPTION_CHARS = 200;

/**
 * The question the writer's figure and ask make, or null when either does
 * not parse, its data cannot be found, or the form cannot make a fair one
 * from it. Never throws: a null asks an explanation instead.
 */
export async function poseFigureQuestion(
  written: WrittenFigureQuestion,
  context: FigureResolveContext,
): Promise<StoredFigureQuestion | null> {
  const offer = figureQuestionOffer(written.kind, written.form);
  const caption = typeof written.caption === 'string' ? written.caption.replace(/\s+/g, ' ').trim() : '';
  if (!offer || !caption || caption.length > MAX_CAPTION_CHARS) return null;
  const spec = offer.kind.schema.safeParse(written.spec);
  const ask = offer.form.schema.safeParse(written.ask);
  if (!spec.success || !ask.success) return null;
  let resolved: unknown = undefined;
  if (offer.kind.resolve) {
    resolved = await offer.kind.resolve(spec.data, context).catch(() => null);
    if (resolved == null) return null;
  }
  let posed;
  try {
    posed = offer.form.pose({ spec: spec.data, resolved, ask: ask.data });
  } catch {
    return null;
  }
  if (!posed) return null;
  return {
    kind: offer.kind.id,
    form: offer.form.id,
    caption,
    spec: posed.spec,
    ...(posed.resolved !== undefined ? { resolved: posed.resolved } : {}),
    prompt: posed.prompt,
    ...(posed.choices ? { choices: posed.choices } : {}),
    answer: posed.answer,
  };
}

/** A stored question read back, or null when it is not one this app can show. */
export function readStoredFigureQuestion(value: unknown): StoredFigureQuestion | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const text = (key: string) => (typeof row[key] === 'string' ? (row[key] as string) : null);
  const kind = text('kind');
  const form = text('form');
  const caption = text('caption');
  const prompt = text('prompt');
  const answer = text('answer');
  if (!kind || !form || !caption || !prompt || answer === null) return null;
  let choices: StoredFigureQuestion['choices'];
  if (row.choices !== undefined) {
    if (!Array.isArray(row.choices)) return null;
    choices = [];
    for (const item of row.choices) {
      const choice = item as Record<string, unknown> | null;
      if (!choice || typeof choice.value !== 'string' || typeof choice.label !== 'string') return null;
      choices.push({ value: choice.value, label: choice.label, ...(choice.spec !== undefined ? { spec: choice.spec } : {}) });
    }
  }
  return {
    kind,
    form,
    caption,
    spec: row.spec ?? null,
    ...(row.resolved !== undefined ? { resolved: row.resolved } : {}),
    prompt,
    ...(choices ? { choices } : {}),
    answer,
  };
}

/** The question as the page draws it, without the answer; null when its form is no longer registered. */
export function figureQuestionView(stored: StoredFigureQuestion): FigureQuestionView | null {
  const offer = figureQuestionOffer(stored.kind, stored.form);
  if (!offer) return null;
  const block = (spec: unknown, caption: string): FigureBlock => ({
    kind: stored.kind,
    caption,
    spec,
    ...(stored.resolved !== undefined ? { resolved: stored.resolved } : {}),
  });
  // A pick's figure is the right option, so the page is sent its caption alone.
  const picks = stored.choices?.some((choice) => choice.spec !== undefined) ?? false;
  return {
    label: offer.form.label,
    figure: block(picks ? null : stored.spec, stored.caption),
    prompt: stored.prompt,
    ...(stored.choices
      ? {
          choices: stored.choices.map((choice) => ({
            value: choice.value,
            label: choice.label,
            ...(choice.spec !== undefined ? { figure: block(choice.spec, choice.label) } : {}),
          })),
        }
      : {}),
  };
}

/**
 * The response as it is kept and quoted: a choice's label for a pick, the
 * typed text otherwise. Null for a pick that names no choice.
 */
export function figureResponse(stored: StoredFigureQuestion, raw: string): string | null {
  const response = raw.trim();
  if (!stored.choices) return response === '' ? null : response;
  return stored.choices.find((choice) => choice.value === response)?.label ?? null;
}

/** The answer in words, shown once the question is graded: the right choice's label, or what the blank held. */
export function figureAnswerLabel(stored: StoredFigureQuestion): string {
  return stored.choices?.find((choice) => choice.value === stored.answer)?.label ?? stored.answer;
}

/**
 * Grades a response by the form's own grader: met, not met, or null when the
 * model has to read it. A pick is graded on the value chosen, never by the
 * model. An unknown form is null, and the model grades it.
 */
export function gradeFigureQuestion(stored: StoredFigureQuestion, raw: string): FigureQuestionVerdict {
  const response = raw.trim();
  if (stored.choices) {
    const choice = stored.choices.find((each) => each.value === response);
    if (!choice) return null;
    return choice.value === stored.answer ? 'met' : 'not_met';
  }
  const offer = figureQuestionOffer(stored.kind, stored.form);
  return offer ? offer.form.grade(stored.answer, response) : null;
}

/** The figure written out for the model grader: its caption, its spec as shown, and the answer. */
export function figureForGrader(stored: StoredFigureQuestion): string {
  return [
    `The figure (${stored.kind}): ${stored.caption}`,
    `As shown, with the blank or the cut: ${JSON.stringify(stored.spec)}`,
    `The answer: ${figureAnswerLabel(stored)}`,
  ].join('\n');
}

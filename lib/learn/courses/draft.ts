/**
 * A course build's work in progress (learn 0197), and the checks each piece
 * passes before it is kept. A build designs an outline (the plan with every
 * step briefed but not written), then writes each stage, then has each
 * rechecked by a second reader, and keeps every piece as it lands. A build
 * that stops, at a usage limit or a restart, picks up from what is kept.
 *
 * The checks are the digest's own (checkDigest): an outline is checked with
 * each step stood in for by a stub that passes, and a stage with the stages
 * not yet written stood in for the same way, so each piece is held to the
 * rules it will face when the course is assembled.
 */
import { checkDigest, type Digest, type Lecture } from './digest';

export type Draft = {
  outline: Record<string, unknown> | null;
  stages: Record<string, Record<string, unknown>>;
  reviewed: string[];
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function readDraft(value: unknown): Draft {
  const raw = isObject(value) ? value : {};
  return {
    outline: isObject(raw.outline) ? raw.outline : null,
    stages: isObject(raw.stages) ? (raw.stages as Draft['stages']) : {},
    reviewed: list(raw.reviewed).filter((key): key is string => typeof key === 'string'),
  };
}

/** About five minutes of reading: enough for a stub step to pass the length check. */
const FILLER = Array.from({ length: 1200 }, () => 'word').join(' ');

/**
 * An outline stage as a stage that passes: its steps' titles and gains, with
 * filler for the lesson, and, when asked, the clips each step plans, so the
 * clips are checked against the lectures and the budget before any writing.
 */
function stub(stage: Json, withClips = false): Json {
  return {
    key: stage.key,
    short: stage.short,
    title: stage.title,
    about: stage.about,
    after: stage.after,
    steps: list(stage.steps).map((step) => ({
      title: isObject(step) ? step.title : '',
      gain: isObject(step) ? step.gain : '',
      blocks: [
        { type: 'text', body: FILLER },
        ...(withClips && isObject(step)
          ? list(step.clips)
              .filter(isObject)
              .map((clip) => ({ listenFor: 'planned', ...clip, type: 'clip' }))
          : []),
      ],
    })),
  };
}

const outlineStages = (outline: Json): Json[] =>
  list(isObject(outline.plan) ? outline.plan.stages : []).filter(isObject);

/**
 * Check an outline before any stage is written: every stage's place and name,
 * every step's title and gain, every lecture rated, the big ideas, the
 * errors, and the clips it plans against the budget.
 */
export function checkOutline(
  outline: unknown,
  lectures: readonly Lecture[],
):
  | { ok: true; stages: number; steps: number; clipMinutes: number }
  | { ok: false; problems: string[] } {
  if (!isObject(outline) || !isObject(outline.plan))
    return { ok: false, problems: ['The outline has no plan.'] };
  const problems: string[] = [];
  const stages = outlineStages(outline);
  stages.forEach((stage) =>
    list(stage.steps).forEach((step, at) => {
      if (!isObject(step) || typeof step.brief !== 'string' || step.brief.trim().length < 80)
        problems.push(
          `Stage ${String(stage.key)}, step ${at + 1} has no brief for its writer (80 characters at least).`,
        );
    }),
  );
  // Checked as the digest will be, with the planned clips in place: lectures, times and budget.
  const checked = checkDigest(
    { ...outline, plan: { ...outline.plan, stages: stages.map((stage) => stub(stage, true)) } },
    lectures,
  );
  if (!checked.ok) problems.push(...checked.problems);
  if (problems.length > 0 || !checked.ok) return { ok: false, problems };
  const steps = checked.digest.plan.stages.flatMap((stage) => stage.steps);
  return {
    ok: true,
    stages: stages.length,
    steps: steps.length,
    clipMinutes: steps
      .flatMap((step) => step.blocks)
      .reduce((sum, block) => sum + (block.type === 'clip' ? block.minutes : 0), 0),
  };
}

/**
 * Check one written stage in its place: the outline around it as stubs, so
 * only this stage's problems are listed, with the budget left to the
 * assembled course.
 */
export function checkStage(
  outline: unknown,
  key: string,
  stage: unknown,
  lectures: readonly Lecture[],
): { ok: true; steps: number; clips: number } | { ok: false; problems: string[] } {
  if (!isObject(outline) || !isObject(outline.plan))
    return { ok: false, problems: ['There is no outline to check the stage against.'] };
  if (!isObject(stage)) return { ok: false, problems: ['The stage is not an object.'] };
  const stages = outlineStages(outline);
  const at = stages.findIndex((item) => item.key === key);
  if (at < 0) return { ok: false, problems: [`The outline has no stage ${key}.`] };
  if (stage.key !== key)
    return { ok: false, problems: [`The file is stage ${String(stage.key)}, not ${key}.`] };
  const placed = stages.map((item, index) => (index === at ? stage : stub(item)));
  const checked = checkDigest(
    { ...outline, plan: { ...outline.plan, budgetMinutes: 100000, stages: placed } },
    lectures,
  );
  if (!checked.ok) {
    const mine = checked.problems.filter(
      (problem) =>
        problem.startsWith(`Stage ${at + 1},`) ||
        problem.startsWith(`Stage ${at + 1} `) ||
        /names "/.test(problem),
    );
    if (mine.length > 0) return { ok: false, problems: mine };
    return { ok: false, problems: checked.problems };
  }
  const written = checked.digest.plan.stages[at];
  return {
    ok: true,
    steps: written.steps.length,
    clips: written.steps.flatMap((step) => step.blocks).filter((block) => block.type === 'clip')
      .length,
  };
}

/** How far a build's writing has got, for `next` and the build page. */
export function draftProgress(draft: Draft) {
  const keys = draft.outline ? outlineStages(draft.outline).map((stage) => String(stage.key)) : [];
  return {
    outline: draft.outline !== null,
    stages: keys.length,
    written: keys.filter((key) => key in draft.stages),
    reviewed: keys.filter((key) => draft.reviewed.includes(key)),
    toWrite: keys.filter((key) => !(key in draft.stages)),
    toReview: keys.filter((key) => key in draft.stages && !draft.reviewed.includes(key)),
  };
}

/** The digest the draft comes to: the outline with every stage as written, checked whole. */
export function assembleDraft(
  draft: Draft,
  lectures: readonly Lecture[],
): { ok: true; digest: Digest; input: Json } | { ok: false; problems: string[] } {
  if (!draft.outline) return { ok: false, problems: ['There is no outline yet.'] };
  const progress = draftProgress(draft);
  if (progress.toWrite.length > 0)
    return { ok: false, problems: [`Not written yet: ${progress.toWrite.join(', ')}.`] };
  const outline = draft.outline;
  const plan = outline.plan as Json;
  const input = {
    ...outline,
    plan: {
      ...plan,
      stages: outlineStages(outline).map((stage) => draft.stages[String(stage.key)]),
    },
  };
  const checked = checkDigest(input, lectures);
  if (!checked.ok) return checked;
  return { ok: true, digest: checked.digest, input };
}

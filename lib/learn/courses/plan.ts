/**
 * Walking a course's plan (lib/learn/courses/digest.ts): which step is next,
 * what opens when a stage is finished, and how the stages sit on the page.
 * No reading or writing; the pages and their tests share these.
 */
import type { Plan, Stage, Step } from './digest';

export type Placed = { stage: Stage; step: Step; at: number };

/** Every step of the plan with its stage, in the order the plan lists them. */
export function placedSteps(plan: Plan): Placed[] {
  return plan.stages.flatMap((stage) => stage.steps.map((step, at) => ({ stage, step, at })));
}

export function findStep(plan: Plan, key: string): Placed | null {
  return placedSteps(plan).find((placed) => placed.step.key === key) ?? null;
}

const finished = (stage: Stage, done: ReadonlySet<string>) =>
  stage.steps.every((step) => done.has(step.key));
const started = (stage: Stage, done: ReadonlySet<string>) =>
  stage.steps.some((step) => done.has(step.key));

/** A stage is open once every stage it comes after is finished. */
export function isOpen(plan: Plan, stage: Stage, done: ReadonlySet<string>): boolean {
  return stage.after.every((key) => {
    const earlier = plan.stages.find((item) => item.key === key);
    return !earlier || finished(earlier, done);
  });
}

/**
 * The step to take next: the first one not done in a stage already begun,
 * else in the first open stage, else anywhere. Null when the plan is done.
 * A stage begun comes first so that a branch chosen is a branch followed.
 */
export function nextStep(plan: Plan, done: ReadonlySet<string>): Placed | null {
  const unfinished = plan.stages.filter((stage) => !finished(stage, done));
  const stage =
    unfinished.find((item) => started(item, done)) ??
    unfinished.find((item) => isOpen(plan, item, done)) ??
    unfinished[0];
  if (!stage) return null;
  const at = stage.steps.findIndex((step) => !done.has(step.key));
  return { stage, step: stage.steps[at], at };
}

/**
 * What follows a step: the next step of its stage, or, at the end of a
 * stage, the stages that come after it. More than one is a choice of branch.
 */
export function afterStep(plan: Plan, key: string): { step: Step | null; stages: Stage[] } {
  const placed = findStep(plan, key);
  if (!placed) return { step: null, stages: [] };
  const step = placed.stage.steps[placed.at + 1] ?? null;
  if (step) return { step, stages: [] };
  return {
    step: null,
    stages: plan.stages.filter((stage) => stage.after.includes(placed.stage.key)),
  };
}

/**
 * The stages as rows down the page. Stages listed one after another that come
 * after the same stages are branches of one fork and share a row.
 */
export function stageRows(plan: Plan): Stage[][] {
  const rows: Stage[][] = [];
  for (const stage of plan.stages) {
    const row = rows[rows.length - 1];
    const same =
      row !== undefined &&
      stage.after.length > 0 &&
      row[0].after.length === stage.after.length &&
      row[0].after.every((key) => stage.after.includes(key));
    if (same) row.push(stage);
    else rows.push([stage]);
  }
  return rows;
}

/** The names of the stages a stage comes after, for a line under its title. */
export function afterTitles(plan: Plan, stage: Stage): string[] {
  return stage.after.flatMap((key) => {
    const earlier = plan.stages.find((item) => item.key === key);
    return earlier ? [earlier.title] : [];
  });
}

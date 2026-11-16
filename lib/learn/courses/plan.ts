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

/** The map names of the stages a stage comes after, for the line over its title. */
export function afterNames(plan: Plan, stage: Stage): string[] {
  return stage.after.flatMap((key) => {
    const earlier = plan.stages.find((item) => item.key === key);
    return earlier ? [shortName(earlier)] : [];
  });
}

/** A stage's place on the map: `x` in columns from the left (a branch's leaf is one column), `row` from the top. */
export type MapNode = { key: string; x: number; row: number };
export type MapLayout = {
  nodes: MapNode[];
  /** Every "comes after" as a line from the earlier stage to the later. */
  edges: { from: string; to: string }[];
  columns: number;
  rows: number;
};

/**
 * Where each stage sits on the map. A stage's row is how many stages deep
 * the longest way to it is, so everything it rests on is above it. Its column
 * comes from the tree under the first stage: a stage hangs under the deepest
 * stage it comes after, each stage with nothing under it takes the next
 * column, and a stage with stages under it sits centred over them. A stage
 * that comes after two stages hangs under one and has a line from the other.
 */
export function mapLayout(plan: Plan): MapLayout {
  const byKey = new Map(plan.stages.map((stage) => [stage.key, stage]));
  const row = new Map<string, number>();
  // Stages are listed after the stages they come after (checkDigest), so one pass is enough.
  for (const stage of plan.stages) {
    const above = stage.after.flatMap((key) => (row.has(key) ? [row.get(key)!] : []));
    row.set(stage.key, above.length > 0 ? Math.max(...above) + 1 : 0);
  }
  const under = new Map<string, string[]>();
  const tops: string[] = [];
  for (const stage of plan.stages) {
    const parents = stage.after.filter((key) => byKey.has(key));
    if (parents.length === 0) {
      tops.push(stage.key);
      continue;
    }
    const parent = parents.reduce((deepest, key) =>
      row.get(key)! > row.get(deepest)! ? key : deepest,
    );
    under.set(parent, [...(under.get(parent) ?? []), stage.key]);
  }

  const x = new Map<string, number>();
  let columns = 0;
  const place = (key: string): number => {
    const below = (under.get(key) ?? []).map(place);
    const at = below.length > 0 ? (below[0] + below[below.length - 1]) / 2 : columns++;
    x.set(key, at);
    return at;
  };
  tops.forEach(place);

  return {
    nodes: plan.stages.map((stage) => ({
      key: stage.key,
      x: x.get(stage.key) ?? 0,
      row: row.get(stage.key) ?? 0,
    })),
    edges: plan.stages.flatMap((stage) =>
      stage.after.filter((key) => byKey.has(key)).map((from) => ({ from, to: stage.key })),
    ),
    columns: Math.max(1, columns),
    rows: Math.max(0, ...row.values()) + 1,
  };
}

/** A stage's name on the map. A plan kept before stages carried one falls back to the start of its title. */
export function shortName(stage: Stage): string {
  if (stage.short) return stage.short;
  const head = stage.title.split(':').pop()!.trim();
  return head.length > 24 ? `${head.slice(0, 23).trimEnd()}…` : head;
}

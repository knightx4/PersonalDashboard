/**
 * The goal page (plan #1078, under #1072): its stages and which of them is
 * the one to show open, the rhythm steps with their weeks, and what Dash
 * found, each as one plain sentence naming the step it came from.
 *
 * Pure, so the page's reading of the tree is tested without a database.
 */
import type { StepNode } from '@/lib/goals/steps';

/**
 * Where a stage stands: finished, under way, held by a step in another
 * stage, or not started. More than one stage can be under way at once.
 */
export type StageState = 'done' | 'current' | 'waiting' | 'later';

export type Stage = {
  id: string;
  title: string;
  /** 1-based, in page order. */
  index: number;
  state: StageState;
  /** Its own steps that are finished, and those that count: every one not dropped. */
  done: number;
  live: number;
  /**
   * What holds it while it is not finished: the index of each other stage
   * holding a step it waits on, and whether it also waits on a step outside
   * the stages (a loose step, or one under another goal).
   */
  waitsOn: number[];
  waitsElsewhere: boolean;
};

function counts(step: StepNode): boolean {
  if (step.status === 'dropped') return false;
  // A question put aside with Not now is out of view, so out of the count.
  return !(step.kind === 'decision' && step.dismissedAt);
}

function finished(step: StepNode): boolean {
  if (step.status === 'done' || step.status === 'dropped') return true;
  const live = step.children.filter(counts);
  return live.length > 0 && live.every((child) => child.status === 'done');
}

function holds(step: StepNode): boolean {
  return (step.status === 'open' || step.status === 'blocked') && counts(step);
}

function descendants(step: StepNode): StepNode[] {
  return step.children.flatMap((child) => [child, ...descendants(child)]);
}

/** Whether any work under a stage has been done: a step closed, or a result Dash wrote. */
function started(step: StepNode): boolean {
  return descendants(step).some(
    (node) => counts(node) && (node.status === 'done' || Boolean(node.result?.trim())),
  );
}

/**
 * The steps outside a stage that hold it: those the stage itself waits on,
 * or, when every open step in it waits on something, what they wait on.
 * A stage with one open step free to move is not held.
 */
function holders(step: StepNode, inside: ReadonlySet<string>): string[] {
  const outside = (refs: StepNode['waitingOn']) =>
    (refs ?? []).map((ref) => ref.id).filter((id) => !inside.has(id));
  const own = outside(step.waitingOn);
  if (own.length > 0) return own;
  const open = step.children.filter(holds);
  if (open.length === 0) return [];
  const each = open.map((child) => outside(child.waitingOn));
  if (each.some((ids) => ids.length === 0)) return [];
  return [...new Set(each.flat())];
}

/**
 * A goal's stages: its top-level steps that hold steps of their own, when
 * there are at least two of them, which is when StepTree draws the goal in
 * stages. Null for a goal that is one list of steps.
 *
 * Stages are parts of the path, and the morning run works a ready step in
 * any of them, so more than one can be under way. A stage not finished is:
 *
 *  - waiting, when a step in another stage (or outside the stages) holds it,
 *    by a dependency on the stage or on every open step in it;
 *  - current, when it is not held and work in it has started, and the first
 *    stage neither finished nor held is always current, so the page opens
 *    at least one;
 *  - later, otherwise.
 *
 * When every stage left is held, the first of them is current, so the page
 * still opens the one to look at. The waits count only once
 * `attachDependencies` has run on the tree.
 */
export function goalStages(steps: readonly StepNode[]): Stage[] | null {
  const tops = steps.filter((step) => step.children.length > 0);
  if (tops.length < 2) return null;
  const stageOfStep = new Map<string, number>();
  tops.forEach((step, i) => {
    for (const node of [step, ...descendants(step)]) stageOfStep.set(node.id, i + 1);
  });

  let anyCurrent = false;
  const stages = tops.map((step, i): Stage => {
    const live = step.children.filter(counts);
    const inside = new Set([step, ...descendants(step)].map((node) => node.id));
    const held = finished(step) ? [] : holders(step, inside);
    const waitsOn = [
      ...new Set(held.flatMap((id) => (stageOfStep.has(id) ? [stageOfStep.get(id)!] : []))),
    ].sort((a, b) => a - b);
    let state: StageState;
    if (finished(step)) state = 'done';
    else if (held.length > 0) state = 'waiting';
    else if (!anyCurrent || started(step)) state = 'current';
    else state = 'later';
    if (state === 'current') anyCurrent = true;
    return {
      id: step.id,
      title: step.title,
      index: i + 1,
      state,
      done: live.filter((child) => child.status === 'done').length,
      live: live.length,
      waitsOn,
      waitsElsewhere: held.some((id) => !stageOfStep.has(id)),
    };
  });
  if (!anyCurrent) {
    const first = stages.find((stage) => stage.state === 'waiting');
    if (first) first.state = 'current';
  }
  return stages;
}

/** "stage 2", "stages 2 and 4", "stages 1, 2 and 4". */
function stageList(indices: readonly number[]): string {
  if (indices.length === 1) return `stage ${indices[0]}`;
  const head = indices.slice(0, -1).join(', ');
  return `stages ${head} and ${indices[indices.length - 1]}`;
}

/** What a stage waits on, as its line says it: "waiting on stage 2", or null when nothing holds it. */
export function stageWait(stage: Pick<Stage, 'waitsOn' | 'waitsElsewhere'>): string | null {
  if (stage.waitsOn.length > 0) return `waiting on ${stageList(stage.waitsOn)}`;
  if (stage.waitsElsewhere) return 'waiting on another step';
  return null;
}

/**
 * What a stage says on its line: "done", "2 of 5 done", "1 step", and
 * after it what holds it, if anything: "1 step · waiting on stage 2".
 */
export function stageMeta(
  stage: Pick<Stage, 'state' | 'done' | 'live' | 'waitsOn' | 'waitsElsewhere'>,
): string {
  if (stage.state === 'done') return 'done';
  const count =
    stage.done > 0
      ? `${stage.done} of ${stage.live} done`
      : stage.live === 1
        ? '1 step'
        : `${stage.live} steps`;
  const wait = stageWait(stage);
  return wait ? `${count} · ${wait}` : count;
}

/**
 * The name of the stages under way, for the track's label and a heading:
 * "Stage 1 of 6", "Stages 1 and 3 of 6", or "All 6 stages done".
 */
export function stagesLabel(stages: readonly Pick<Stage, 'state' | 'index'>[]): string {
  const current = stages.filter((stage) => stage.state === 'current').map((stage) => stage.index);
  if (current.length === 0) {
    return stages.every((stage) => stage.state === 'done')
      ? `All ${stages.length} stages done`
      : `${stages.length} stages`;
  }
  const list = stageList(current);
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} of ${stages.length}`;
}

/** The goal's live rhythm steps, in the order of the map, for its Rhythm section. */
export function rhythmSteps(steps: readonly StepNode[]): StepNode[] {
  const out: StepNode[] = [];
  const walk = (nodes: readonly StepNode[]) => {
    for (const node of nodes) {
      if (node.status === 'done' || node.status === 'dropped') continue;
      if (node.kind === 'rhythm' && node.rhythmCount && node.rhythmPeriod) out.push(node);
      walk(node.children);
    }
  };
  walk(steps);
  return out;
}

/** One thing Dash found, as the page says it. */
export type Finding = {
  stepId: string;
  /** The step it came from, named beside the fact. */
  from: string;
  fact: string;
  /** Where the full result also lives, when it has a link. */
  url: string | null;
};

/** The longest a fact runs before it is cut, in characters. */
const FACT_MAX = 220;

/**
 * The first sentence of a result, as plain text: markdown marks taken off,
 * the first paragraph that is not a heading, cut where the first sentence ends: a stop
 * followed by a space and a capital, a digit or a dollar sign, or by the end
 * of the paragraph, so "$118,000.50" and "e.g. this" are not cut.
 */
export function firstSentence(markdown: string): string {
  const paragraph =
    markdown
      .split(/\n\s*\n/)
      // A heading names what follows rather than saying it.
      .filter((part) => !/^\s*#/.test(part))
      .map((part) =>
        part
          .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
          .replace(/\*\*|__|`/g, '')
          .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .find((part) => part.length > 0) ?? '';
  const end = /[.!?](?=\s+["“(]?[A-Z0-9$]|$)/.exec(paragraph);
  const sentence = end ? paragraph.slice(0, end.index + 1) : paragraph;
  if (sentence.length <= FACT_MAX) return sentence;
  const cut = sentence.slice(0, FACT_MAX);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : FACT_MAX).replace(/[,;:\s]+$/, '')}…`;
}

/**
 * What Dash found on this goal: every step carrying a result, in the order
 * of the map, each as its first sentence and the step it came from. The
 * full result stays on the step, which the fact links to.
 */
export function goalFindings(steps: readonly StepNode[]): Finding[] {
  const out: Finding[] = [];
  const walk = (nodes: readonly StepNode[]) => {
    for (const node of nodes) {
      if (node.status !== 'dropped' && node.result?.trim()) {
        const fact = firstSentence(node.result);
        if (fact) out.push({ stepId: node.id, from: node.title, fact, url: node.resultUrl });
      }
      walk(node.children);
    }
  };
  walk(steps);
  return out;
}

/**
 * The goal page (plan #1078, under #1072): its stages and which of them is
 * the one to show open, the rhythm steps with their weeks, and what Dash
 * found, each as one plain sentence naming the step it came from.
 *
 * Pure, so the page's reading of the tree is tested without a database.
 */
import type { StepNode } from '@/lib/goals/steps';

/** Where a stage stands: finished, the one being worked, or still ahead. */
export type StageState = 'done' | 'current' | 'later';

export type Stage = {
  id: string;
  title: string;
  /** 1-based, in page order. */
  index: number;
  state: StageState;
  /** Its own steps that are finished, and those that count: every one not dropped. */
  done: number;
  live: number;
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

/**
 * A goal's stages: its top-level steps that hold steps of their own, when
 * there are at least two of them, which is when StepTree draws the goal in
 * stages. The first one not finished is current; those before and after it
 * are done or later by their own state, so a stage finished out of order
 * still reads as done. Null for a goal that is one list of steps.
 */
export function goalStages(steps: readonly StepNode[]): Stage[] | null {
  const tops = steps.filter((step) => step.children.length > 0);
  if (tops.length < 2) return null;
  let current = false;
  return tops.map((step, i) => {
    const live = step.children.filter(counts);
    let state: StageState = 'later';
    if (finished(step)) state = 'done';
    else if (!current) {
      state = 'current';
      current = true;
    }
    return {
      id: step.id,
      title: step.title,
      index: i + 1,
      state,
      done: live.filter((child) => child.status === 'done').length,
      live: live.length,
    };
  });
}

/** What a folded stage says on its closed line: "done", "2 of 5 done", "1 step". */
export function stageMeta(stage: Pick<Stage, 'state' | 'done' | 'live'>): string {
  if (stage.state === 'done') return 'done';
  if (stage.done > 0) return `${stage.done} of ${stage.live} done`;
  return stage.live === 1 ? '1 step' : `${stage.live} steps`;
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

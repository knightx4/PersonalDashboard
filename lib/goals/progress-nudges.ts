/**
 * What the morning run does with the progress record (plan #1281).
 *
 * Two lists for the brief, both read from progress entries
 * (lib/goals/progress.ts). A step under way whose newest entry is a week old
 * or more is stalled, and the run nudges it. A step whose tally has reached
 * its estimated total, or whose newest rough answer is "nearly done" when it
 * has no total, looks finished, and the run offers to close it. Closing stays
 * the person's: an estimate is a guess, so reaching it proves nothing. The
 * goals skill says what the run writes for each ("Steps under way").
 *
 * Which steps are read: a step of the person's (`mine`), open, under an open
 * goal and reached through open steps only, with nothing open beneath it,
 * nothing it waits on and its start date come. A step that looks finished is
 * offered, not nudged, however old its last entry.
 *
 * Pure. The caller reads the entries with loadProgressEntries.
 */
import { waitsOnNothing } from '@/lib/goals/dependencies';
import {
  PROGRESS_ESTIMATE_WORDS,
  tallyWords,
  towardsTotal,
  towardsTotalWords,
  type ItemProgress,
} from '@/lib/goals/progress';
import { STALE_AFTER_DAYS } from '@/lib/goals/stale-steps';
import type { StepNode } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';

/** More than this many of each and the rest wait for tomorrow. */
export const PROGRESS_NUDGE_LIMIT = 10;

export type UnderWayStep = {
  id: string;
  title: string;
  goalId: string;
  goalTitle: string;
  /** YYYY-MM-DD: the day of the newest entry. */
  lastOn: string;
  /** Whole days from the newest entry to today. */
  idleDays: number;
  /** How far along, as the step's line says it: "7 of about 100 bags, …", "7 bags so far", "about half done". */
  sofar: string | null;
};

export type ProgressNudges = {
  /** Under way with nothing logged for STALE_AFTER_DAYS or more, longest first. */
  stalled: UnderWayStep[];
  /** Tally at its total, or "nearly done" with no total, in page order. */
  finished: UnderWayStep[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from one YYYY-MM-DD to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** How far along a step is, in the words its line on the goal page uses. */
function sofarWords(node: StepNode, progress: ItemProgress): string | null {
  const towards = towardsTotal(node.estimatedTotal, node.totalUnit, progress.tallies);
  if (towards) return towardsTotalWords(towards);
  const tally = tallyWords(progress.tallies);
  const estimate = progress.estimate ? PROGRESS_ESTIMATE_WORDS[progress.estimate] : null;
  return [tally, estimate].filter(Boolean).join(', ') || null;
}

/** Whether the record says the step looks done: at its total, or nearly done with none. */
function looksFinished(node: StepNode, progress: ItemProgress): boolean {
  const towards = towardsTotal(node.estimatedTotal, node.totalUnit, progress.tallies);
  if (towards) return towards.left === 0;
  return progress.estimate === 'nearly';
}

/** The stalled and finished steps under way, from each step's progress by id. */
export function progressNudges(
  goals: Goal[],
  stepsByGoal: Map<string, StepNode[]>,
  progress: Readonly<Record<string, ItemProgress>>,
  today: string,
): ProgressNudges {
  const stalled: UnderWayStep[] = [];
  const finished: UnderWayStep[] = [];
  for (const goal of goals) {
    if (goal.status !== 'open') continue;
    const walk = (nodes: StepNode[]) => {
      for (const node of nodes) {
        if (node.status !== 'open') continue;
        if (node.waitsUntil) continue;
        const record = progress[node.id];
        if (record && node.kind === 'mine' && waitsOnNothing(node)) {
          const step: UnderWayStep = {
            id: node.id,
            title: node.title,
            goalId: goal.id,
            goalTitle: goal.title,
            lastOn: record.lastOn,
            idleDays: daysBetween(record.lastOn, today),
            sofar: sofarWords(node, record),
          };
          if (looksFinished(node, record)) finished.push(step);
          else if (step.idleDays >= STALE_AFTER_DAYS) stalled.push(step);
        }
        walk(node.children);
      }
    };
    walk(stepsByGoal.get(goal.id) ?? []);
  }
  return {
    stalled: stalled.sort((a, b) => b.idleDays - a.idleDays).slice(0, PROGRESS_NUDGE_LIMIT),
    finished: finished.slice(0, PROGRESS_NUDGE_LIMIT),
  };
}

/** One step's line in the morning brief. */
export function underWayLine(step: UnderWayStep): string {
  return (
    `- "${step.title}" (goals.items id ${step.id}), under the goal "${step.goalTitle}": ` +
    (step.sofar ? `${step.sofar}; ` : '') +
    `last logged ${step.lastOn}, ${step.idleDays} ${step.idleDays === 1 ? 'day' : 'days'} ago`
  );
}

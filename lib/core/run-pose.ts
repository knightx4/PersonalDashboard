/**
 * What Dash's mark should be doing, read from the newest line a run wrote
 * (core.run_activities). The runner card's Dashes and the mark beside a run's
 * title both follow it, so the two always agree.
 *
 * A line gives a pose and, sometimes, a moment:
 *
 *   pose     asking while a question waits on you; otherwise working, in the
 *            shape of the work the line describes: reading, searching,
 *            testing, writing or thinking.
 *   moment   a one-off on top of the pose, played once per line: a wince for
 *            an error the run carries on from, a hop for a step closed or a
 *            commit made.
 *
 * The kind of work is read from the line's words. A run writes in plain
 * sentences ("Reading the plan's acceptance criteria", "Running the gate"),
 * so a handful of verbs place nearly every line; anything they miss is a
 * thought, which is what an unplaced line usually is.
 */
import type { RunActivity } from './run-activities';

export type RunPoseActivity = 'reading' | 'searching' | 'testing' | 'writing' | 'thinking';

export type RunPose = {
  state: 'working' | 'asking';
  activity?: RunPoseActivity;
};

export type RunMoment = { kind: 'wince' | 'hop'; id: string };

/** Checked in this order: the first that matches places the line. */
const WORDS: readonly (readonly [RunPoseActivity, RegExp])[] = [
  ['testing', /\b(test(s|ing|ed)?|gate|lint(ing|ed)?|typecheck(ing|ed)?|vitest|verif(y|ying|ied)|checks?|checking)\b/i],
  ['searching', /\b(search(es|ing|ed)?|grep(ping|ped)?|find(ing)?|look(s|ing)? for|scan(s|ning|ned)?|explor(e|es|ing|ed)|locat(e|es|ing|ed)|trac(e|es|ing|ed))\b/i],
  ['reading', /\b(read(s|ing)?|open(s|ing|ed)?|review(s|ing|ed)?|look(s|ing|ed)? (at|through|over)|inspect(s|ing|ed)?|stud(y|ies|ying|ied))\b/i],
  ['writing', /\b(writ(e|es|ing|ten)|wrote|edit(s|ing|ed)?|draft(s|ing|ed)?|implement(s|ing|ed)?|add(s|ing|ed)?|build(s|ing)?|fix(es|ing|ed)?|chang(e|es|ing|ed)|refactor(s|ing|ed)?|updat(e|es|ing|ed)|creat(e|es|ing|ed)|remov(e|es|ing|ed)|renam(e|es|ing|ed)|commit(s|ting|ted)?|redraw(s|ing|n)?)\b/i],
];

/** An action that finished a piece of work. */
const FINISHED =
  /\b(commit(ted)?|closed (step|#)|clos(ed|ing) the step|pushed|merged|step #?[\d.]+ (is )?(done|closed)|marked .* done)\b/i;

/** The pose for the newest line, or plain working when there is none yet. */
export function runPose(line: RunActivity | null | undefined): RunPose {
  if (!line) return { state: 'working' };
  if (line.kind === 'question') return { state: 'asking' };
  if (line.kind === 'response') return { state: 'working', activity: 'thinking' };
  if (line.kind === 'error') return { state: 'working', activity: 'thinking' };
  for (const [activity, words] of WORDS) {
    if (words.test(line.body)) return { state: 'working', activity };
  }
  return { state: 'working', activity: line.kind === 'action' ? 'writing' : 'thinking' };
}

/** The moment the newest line plays once, if it is one that plays any. */
export function runMoment(line: RunActivity | null | undefined): RunMoment | null {
  if (!line) return null;
  if (line.kind === 'error') return { kind: 'wince', id: line.id };
  if (line.kind === 'action' && FINISHED.test(line.body)) return { kind: 'hop', id: line.id };
  return null;
}

/** The shortest time a pose holds before the next one takes over, so a burst of lines does not flicker. */
export const POSE_HOLD_MS = 2000;

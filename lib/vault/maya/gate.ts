import type { JevQuestion, JevResult, JevYesNoAnswer } from '@/lib/jev/wire';
import { tooShortForMap, whyNotRead, type NotRead } from '@/lib/vault/map/rules';

/**
 * Whether Maya writes on a note without being asked (plan #1288).
 *
 * After each sync the hourly job (plan #1289) asks Jev one question about each
 * new note version: does it hold a live question? Maya writes a thought only
 * on a note Jev is sure of. The line was set by a report-only trial on the
 * person's notes (scripts/maya-gate-trial.ts, written up in
 * docs/trials/2026-09-30-maya-gate.md).
 *
 * Strict by design. There is no Haiku fallback: when Jev is off for the
 * account, has no key, errors or answers something unreadable, the note gets
 * no automatic thought. A missed thought costs nothing, since the person can
 * still ask Maya from the note page; an unwanted one is Maya writing unasked
 * on a note that did not call for it.
 *
 * The rules live here with no I/O, following lib/goals/hold-acts.ts, so the
 * trial and the job ask the same question of the same text and pass at the
 * same line.
 */

/**
 * Jev's probability of a yes at or above which Maya writes. Set from the
 * trial of 2026-09-30 on 200 notes (docs/trials/2026-09-30-maya-gate.md):
 * four of 177 notes clear 0.95 and all four hold a live question. At 0.94 the
 * first class notes come through, and at 0.90 five of 24 are course records,
 * case notes or fiction drafts.
 */
export const MAYA_GATE_THRESHOLD = 0.95;

/**
 * How much of the body Jev reads. Longer than the map's 1,500-character
 * sample (lib/learn/vault/classify-payload.ts) because a note's open question
 * often comes after the material it is about. Well inside Jev's 32k tokens.
 */
export const MAYA_GATE_SAMPLE_CHARS = 4_000;

export const MAYA_GATE_QUESTION = {
  type: 'yes-no',
  question:
    'This is one of somebody\'s personal notes. Is the writer working something out in it: an open question, a tension between two views, or a position of their own they are still arguing for, which a thoughtful partner could usefully argue with?',
  yes: 'The writer states or implies a question they have not settled, weighs views against each other, or argues a view of their own that could be pushed back on.',
  no: 'Nothing is being worked out: logistics, a task list, a record of what happened, contact details, a draft with nothing stated yet, or a summary of somebody else\'s argument with no view of the writer\'s own.',
} as const satisfies JevQuestion;

/** A note as the gate reads it. The path is used only to refuse, never sent. */
export type GateNote = { path: string; title: string; body: string };

export type GateRefusal = NotRead | { reason: 'too-short'; detail: string };

/**
 * Why this note is never put to Jev, or null when it may be. The map's rules
 * (whyNotRead: the Me folder, Career/Job Applications, anything shaped like an
 * API key) and its 80-character floor. A refused note gets no automatic
 * thought and costs no call.
 */
export function gateRefusal(note: Pick<GateNote, 'path' | 'body'>): GateRefusal | null {
  const refused = whyNotRead({ path: note.path, body: note.body });
  if (refused) return refused;
  if (tooShortForMap(note.body)) {
    return { reason: 'too-short', detail: 'Not asked: the note is too short to hold a question.' };
  }
  return null;
}

/** What Jev reads: the title and the opening of the body. Never the path. */
export function mayaGateState(note: Pick<GateNote, 'title' | 'body'>): Record<string, string> {
  const body = note.body.trim();
  return {
    title: note.title,
    text: body.length <= MAYA_GATE_SAMPLE_CHARS ? body : body.slice(0, MAYA_GATE_SAMPLE_CHARS),
  };
}

/** Whether Jev's probability of a yes clears the line. */
export function passesGate(probability: number): boolean {
  return Number.isFinite(probability) && probability >= MAYA_GATE_THRESHOLD;
}

/** The values obsidian.maya_gate_checks.outcome takes. */
export type GateOutcome = 'thought' | 'skip' | 'failed' | 'not_enabled';

export type GateVerdict = {
  /** True only when Jev answered and cleared the line. */
  passes: boolean;
  /**
   * For maya_gate_checks.outcome. 'thought' means the note passed; the job
   * writes it once Maya has written, and may record 'skip' instead when the
   * daily cap is reached.
   */
  outcome: GateOutcome;
  /** For maya_gate_checks.probability; null when Jev did not answer. */
  probability: number | null;
  /** For maya_gate_checks.jev_model; null when Jev did not answer. */
  jevModel: string | null;
  /** Why it failed, for logs. Never carries note text. */
  failure: string | null;
};

/**
 * Turn Jev's answer into pass or fail. `enabled` is jevEnabledFor for the
 * account (lib/jev/enabled.ts); when it is false Jev must not have been asked,
 * and `result` is ignored. A null or failed result never passes.
 */
export function gateVerdict(
  result: JevResult<JevYesNoAnswer> | null,
  enabled: boolean,
): GateVerdict {
  if (!enabled) {
    return { passes: false, outcome: 'not_enabled', probability: null, jevModel: null, failure: null };
  }
  if (!result) {
    return { passes: false, outcome: 'failed', probability: null, jevModel: null, failure: 'not asked' };
  }
  if (!result.ok) {
    return {
      passes: false,
      outcome: 'failed',
      probability: null,
      jevModel: null,
      failure: `${result.reason}: ${result.detail}`.slice(0, 300),
    };
  }
  const { probability } = result.answer;
  const passes = passesGate(probability);
  return { passes, outcome: passes ? 'thought' : 'skip', probability, jevModel: result.model, failure: null };
}

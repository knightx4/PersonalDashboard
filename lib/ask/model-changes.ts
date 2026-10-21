import type { LearnChangeInput } from './learn-changes';

/**
 * The model change Dash makes straight away: the model it answers with
 * switched to Haiku, Sonnet or Opus when asked (plan #2458.4).
 *
 * It takes the shape Learn's six set out (lib/ask/learn-changes.ts): the tool
 * that made the change wrote the sentence and the link when it made it
 * (lib/dash/model-writes.ts), so a card only reads them back. No server
 * imports, so the client cards can use it.
 */

/** The model write tools, by name, which is the kind each change is kept under. */
export const MODEL_CHANGE_KINDS = ['set_dash_model'] as const;

export type ModelChangeKind = (typeof MODEL_CHANGE_KINDS)[number];

/** The same three-part sentence, link and pages a Learn change keeps. */
export type ModelChangeInput = LearnChangeInput;

export function isModelChangeKind(kind: string): kind is ModelChangeKind {
  return (MODEL_CHANGE_KINDS as readonly string[]).includes(kind);
}

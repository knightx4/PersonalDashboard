/**
 * Questions sent to Ask Dash in a row are one question (plan #2988.2). The
 * box no longer waits for an answer before it takes the next text: each text
 * is held in the thread as sent, and the held texts go together as one
 * question once nothing is being answered and the person has stopped
 * sending for the pause the chats use (SETTLE_QUIET_MS in lib/you/reply-turn.ts).
 * A text sent while an answer is being written is held until that answer
 * lands, then goes with no other message needed.
 *
 * These are the pure parts; TalkThread (components/thread/thread.tsx) keeps
 * the held texts and the timer.
 */
import { SETTLE_MAX_MS, SETTLE_QUIET_MS } from '@/lib/you/reply-turn';
import { ATTACHMENTS_PER_ITEM, type UploadedAttachment } from '@/lib/attachments/rules';
import { MAX_TURN, type TalkCitation } from '@/lib/talk/talk';
import { MAX_MENTIONS, type AskMention } from '@/lib/talk/ask-input';
import type { ModuleId } from '@/lib/modules';

/** A text sent from the box that has not gone to Dash yet. `at` is when it was sent, in ms. */
export type HeldQuestion = {
  id: string;
  body: string;
  at: number;
  files: readonly UploadedAttachment[];
  citations: readonly TalkCitation[];
};

/** What held texts are joined with: each stays its own paragraph. */
export const HELD_JOIN = '\n\n';

/**
 * How long to wait before the held texts go, or null while an answer is
 * being written (they go once it lands). Zero once the person has been quiet
 * for `quietMs` since the newest, or the oldest has waited `maxMs`.
 */
export function heldWaitMs(
  held: readonly Pick<HeldQuestion, 'at'>[],
  now: number,
  answering: boolean,
  quietMs = SETTLE_QUIET_MS,
  maxMs = SETTLE_MAX_MS,
): number | null {
  if (held.length === 0 || answering) return null;
  const newest = held[held.length - 1].at;
  const oldest = held[0].at;
  const quiet = quietMs - (now - newest);
  const left = maxMs - (now - oldest);
  return Math.max(0, Math.min(quiet, left, quietMs));
}

/**
 * The held texts that go as the next question, oldest first: as many as fit
 * in one turn's length and one item's files, and always the first. The rest
 * stay held and go as the question after.
 */
export function nextBatch(
  held: readonly HeldQuestion[],
  maxChars = MAX_TURN,
  maxFiles = ATTACHMENTS_PER_ITEM,
): { batch: HeldQuestion[]; rest: HeldQuestion[]; body: string; files: UploadedAttachment[] } {
  const batch: HeldQuestion[] = [];
  let chars = 0;
  let files = 0;
  for (const question of held) {
    const addChars = (batch.length > 0 ? HELD_JOIN.length : 0) + question.body.length;
    if (batch.length > 0 && (chars + addChars > maxChars || files + question.files.length > maxFiles)) break;
    batch.push(question);
    chars += addChars;
    files += question.files.length;
  }
  return {
    batch,
    rest: held.slice(batch.length),
    body: batch.map((question) => question.body).join(HELD_JOIN),
    files: batch.flatMap((question) => question.files),
  };
}

/**
 * The rows each held text took off the box, as the one question's: each row
 * once, as many as a question takes, and the newest workspace to keep the
 * lookups to.
 */
export function heldTogether(taken: readonly { rows: readonly AskMention[]; scope: ModuleId | null }[]): {
  rows: AskMention[];
  scope: ModuleId | null;
} {
  const rows: AskMention[] = [];
  for (const row of taken.flatMap((sent) => sent.rows)) {
    if (rows.length >= MAX_MENTIONS) break;
    if (!rows.some((r) => r.kind === row.kind && r.id === row.id)) rows.push(row);
  }
  return { rows, scope: taken.at(-1)?.scope ?? null };
}

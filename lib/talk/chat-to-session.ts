import { SESSION_MESSAGE_MAX } from '@/lib/core/session-threads-model';
import type { TalkTurn } from './talk';

/**
 * Taking an Ask Dash chat to a session thread (plan #2789.8, feature #2789).
 *
 * The first message of the thread is the chat so far, written out in turns,
 * so the person does not retell it. The project comes from the chat: the one
 * whose name the chat mentions most, else this app. Pure, so the action, the
 * button and the tests read it the same way.
 */

/**
 * The sentence Dash ends an answer with when the request needs a code change
 * (the CODE CHANGES rule in lib/dash/ask.ts). The answer carrying it makes the
 * button under it a plain offer instead of a quiet icon.
 */
export const SESSION_OFFER = 'I can take this to a code session.';

/** Whether an answer is Dash offering the session. */
export function offersSession(body: string): boolean {
  return body.includes(SESSION_OFFER);
}

const HEADING = 'From my Ask Dash chat. This is the conversation so far; please carry on from it.';

/** The heading of a question sent to think through (plan #2789.11). */
const THINK_HEADING =
  'From my Ask Dash chat, with Think it through on. Please think my last question through; the conversation so far is below.';

/** Said in place of the start of a chat too long to send. */
const CUT = '(The start of the chat is left out because it was too long.)';

function turnText(turn: Pick<TalkTurn, 'role' | 'body'>): string {
  const body = turn.body.replace(SESSION_OFFER, '').trim();
  return `${turn.role === 'user' ? 'Me' : 'Dash'}: ${body}`;
}

/**
 * The chat as the thread's first message: the newest turns that fit in
 * SESSION_MESSAGE_MAX, oldest first, each under who said it. A chat with no
 * words in it gives an empty string.
 */
export function chatAsMessage(
  turns: readonly Pick<TalkTurn, 'role' | 'body'>[],
  options: { think?: boolean } = {},
): string {
  const heading = options.think ? THINK_HEADING : HEADING;
  const lines = turns.filter((t) => t.body.trim()).map(turnText);
  if (lines.length === 0) return '';
  const room = SESSION_MESSAGE_MAX - heading.length - CUT.length - 8;
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = lines[i].length + 2;
    if (used + cost > room) {
      // The newest turn is sent even when it alone is too long, cut to fit.
      if (kept.length === 0) kept.unshift(lines[i].slice(0, room));
      break;
    }
    kept.unshift(lines[i]);
    used += cost;
  }
  const cut = kept.length < lines.length;
  return [heading, ...(cut ? [CUT] : []), kept.join('\n\n')].join('\n\n');
}

export type SessionProjectChoice = { id: string; label: string };

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The project the chat is about: the one whose label or id appears most often
 * in what was said, a tie going to the one named last; null (this app) when
 * none is named. Matches whole words, ignoring case.
 */
export function suggestProject(
  turns: readonly Pick<TalkTurn, 'body'>[],
  projects: readonly SessionProjectChoice[],
): string | null {
  const text = turns.map((t) => t.body).join('\n').toLowerCase();
  let best: { id: string; count: number; last: number } | null = null;
  for (const project of projects) {
    let count = 0;
    let last = -1;
    for (const name of new Set([project.label.toLowerCase().trim(), project.id.toLowerCase()])) {
      if (!name) continue;
      const word = new RegExp(`(?<![\\p{L}\\p{N}])${escaped(name)}(?![\\p{L}\\p{N}])`, 'gu');
      for (const match of text.matchAll(word)) {
        count++;
        last = Math.max(last, match.index ?? 0);
      }
    }
    if (count > 0 && (!best || count > best.count || (count === best.count && last > best.last))) {
      best = { id: project.id, count, last };
    }
  }
  return best?.id ?? null;
}

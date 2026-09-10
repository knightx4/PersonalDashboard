import 'server-only';

import { timingSafeEqual } from 'node:crypto';

/**
 * The code the header panel asks for before it writes anything.
 *
 * One check, wherever the panel files to. It started beside the notes queue's
 * own action, which was fine while that was the only thing the panel could
 * write; the idea tab files into a different table through a different action,
 * and a second copy of a security check is how the two of them quietly stop
 * agreeing.
 *
 * Overridable with FEEDBACK_CODE so the value can live in the environment
 * rather than in the repository; the fallback keeps the button working out of
 * the box.
 */
function expectedCode(): string {
  return process.env.FEEDBACK_CODE ?? '1612*';
}

/** Constant-time compare, so the check cannot be probed character by character. */
export function codeMatches(given: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expectedCode());
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

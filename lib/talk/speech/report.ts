/**
 * The log a silent phone leaves (plan #3068): each reason a reply did not
 * sound, from the player (lib/talk/speech/player.ts) or the output
 * (lib/talk/speech/output.ts), goes to the browser's console and, a few a
 * page, to /api/speak/report, which writes it to the server log with what
 * the context and the element were doing. A phone's console cannot be read
 * afterwards; the server log can.
 */

import { speechOutputState } from './output';

/** How many failures one page sends, so a stuck loop cannot fill the log. */
const SENT_PER_PAGE = 20;

let sent = 0;

export function reportSpeechFailure(failure: object): void {
  const line = { ...failure, ...speechOutputState() };
  console.warn('[speech] not heard', line);
  if (sent >= SENT_PER_PAGE || typeof fetch === 'undefined') return;
  sent += 1;
  try {
    void fetch('/api/speak/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(line),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* The log never stops the sound. */
  }
}

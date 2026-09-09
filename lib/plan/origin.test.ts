import { describe, expect, it } from 'vitest';
import { reshapeOrigin, reshapeStamp } from './origin';

/**
 * The stamp a re-shape leaves, and reading it back.
 *
 * Worth pinning because both halves have to agree about one line of text
 * forever: the page and the brief read what the CLI wrote, and a step whose
 * stamp stops parsing is a row that has quietly lost the only explanation of
 * why it exists.
 */

describe('reshapeStamp', () => {
  it('names the decision and quotes its answer', () => {
    expect(reshapeStamp(63, 'On the server, not the client.')).toBe(
      "From #63's answer: On the server, not the client.",
    );
  });

  it('takes the first line of a long answer, so it fits on a row', () => {
    expect(reshapeStamp(7, '\n\nB\n\nBecause the other two cost a migration.')).toBe(
      "From #7's answer: B",
    );
  });

  it('trims an answer written as one very long line', () => {
    const stamp = reshapeStamp(7, 'x'.repeat(400));
    expect(stamp.length).toBeLessThan(200);
    expect(stamp.endsWith('…')).toBe(true);
  });
});

describe('reshapeOrigin', () => {
  it('reads back what the stamp wrote', () => {
    const origin = reshapeOrigin(reshapeStamp(63, 'On the server, not the client.'));
    expect(origin).toEqual({ number: 63, gist: 'On the server, not the client.' });
  });

  it('still finds it under the dated lines a step collects afterwards', () => {
    const comment = [
      "From #63's answer: On the server, not the client.",
      '',
      'Blocked 2026-09-09: waiting on the key.',
    ].join('\n');
    expect(reshapeOrigin(comment)?.number).toBe(63);
  });

  it('says nothing about a step nobody re-shaped', () => {
    expect(reshapeOrigin(null)).toBeNull();
    expect(reshapeOrigin('Waiting on the RPC review.')).toBeNull();
    // Near-misses are not stamps. Guessing at one would put a made-up cause on
    // a row, which is worse than showing none.
    expect(reshapeOrigin('From #63 answer: something')).toBeNull();
  });
});

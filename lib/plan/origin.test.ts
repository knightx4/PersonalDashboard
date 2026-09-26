import { describe, expect, it } from 'vitest';
import {
  addsAsProposal,
  currentSession,
  reshapeOrigin,
  reshapeStamp,
  sessionOrigin,
  sessionStamp,
} from './origin';

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

describe('sessionStamp and sessionOrigin', () => {
  it('names the session and the day, and reads both back', () => {
    const stamp = sessionStamp({ session: 'cse_019Ni6E79766Hs4ohGiTtYBj', date: '2026-09-26' });
    expect(stamp).toBe('Added by session cse_019Ni6E79766Hs4ohGiTtYBj on 2026-09-26.');
    expect(sessionOrigin(stamp)).toEqual({
      session: 'cse_019Ni6E79766Hs4ohGiTtYBj',
      date: '2026-09-26',
    });
  });

  it('still stamps a session that had no id', () => {
    const stamp = sessionStamp({ session: null, date: '2026-09-26' });
    expect(stamp).toBe('Added by a session on 2026-09-26.');
    expect(sessionOrigin(stamp)).toEqual({ session: null, date: '2026-09-26' });
  });

  it('is found under a re-shape stamp and the dated lines that follow', () => {
    const comment = [
      "From #63's answer: B",
      'Added by session cse_1 on 2026-09-26.',
      '',
      'Blocked 2026-09-27: waiting on the key.',
    ].join('\n');
    expect(sessionOrigin(comment)?.session).toBe('cse_1');
    expect(reshapeOrigin(comment)?.number).toBe(63);
  });

  it('says nothing about a step a person wrote', () => {
    expect(sessionOrigin(null)).toBeNull();
    expect(sessionOrigin("From #63's answer: B")).toBeNull();
    expect(sessionOrigin('Added by me on Tuesday.')).toBeNull();
  });
});

describe('currentSession', () => {
  it('prefers the remote session id, the one runs store', () => {
    expect(
      currentSession({ CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_1', CLAUDE_CODE_SESSION_ID: 'abc' }),
    ).toBe('cse_1');
    expect(currentSession({ CLAUDE_CODE_SESSION_ID: 'abc' })).toBe('abc');
  });

  it('knows a session with no id, and a person with none', () => {
    expect(currentSession({ CLAUDECODE: '1' })).toBeNull();
    expect(currentSession({})).toBeUndefined();
  });
});

describe('addsAsProposal', () => {
  it('writes a step under an approved feature ready', () => {
    expect(addsAsProposal(['not_started'], false)).toBe(false);
    expect(addsAsProposal(['in_progress', 'not_started'], false)).toBe(false);
  });

  it('keeps a step under a proposed row anywhere above as a proposal', () => {
    expect(addsAsProposal(['proposed'], false)).toBe(true);
    expect(addsAsProposal(['not_started', 'proposed'], false)).toBe(true);
  });

  it('lets --proposed hold any step for the person', () => {
    expect(addsAsProposal(['not_started'], true)).toBe(true);
    expect(addsAsProposal([], true)).toBe(true);
    expect(addsAsProposal([], false)).toBe(false);
  });
});

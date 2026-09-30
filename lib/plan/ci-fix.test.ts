import { describe, expect, it } from 'vitest';
import { CI_FIX_HOLD_MS, ciFixRunning, ciFixText } from './ci-fix';

describe('ciFixRunning', () => {
  const now = Date.parse('2026-09-30T18:00:00Z');

  it('holds the button while a fix started within the hour', () => {
    expect(ciFixRunning([new Date(now - 10 * 60 * 1000).toISOString()], now)).toBe(true);
  });

  it('lets it go again once the hour is up', () => {
    expect(ciFixRunning([new Date(now - CI_FIX_HOLD_MS - 1).toISOString()], now)).toBe(false);
    expect(ciFixRunning([], now)).toBe(false);
  });
});

describe('ciFixText', () => {
  it('names the head, the failure and the run', () => {
    const text = ciFixText({
      sha: 'abc1234',
      reason: 'check failed at Typecheck.',
      runUrl: 'https://github.com/x/y/actions/runs/1',
    });
    expect(text).toContain('abc1234');
    expect(text).toContain('check failed at Typecheck.');
    expect(text).toContain('actions/runs/1');
    expect(text).toContain('npm run gate');
  });

  it('still says where to look when the failure could not be read', () => {
    const text = ciFixText({ sha: null, reason: null, runUrl: null });
    expect(text).toContain('could not be read');
    expect(text).toContain('list the latest workflow runs');
  });
});

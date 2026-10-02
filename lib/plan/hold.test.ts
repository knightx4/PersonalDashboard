import { describe, expect, it } from 'vitest';
import { SESSION_IDEA_HOLD_ENDS, sessionIdeaHoldActive, shapeHoldReason } from '@/lib/plan/hold';

const DURING = new Date('2026-10-29T23:59:59Z');
const AFTER = new Date('2026-10-30T00:00:00Z');

describe('the four-week hold on session ideas', () => {
  it('ends on 30 October 2026', () => {
    expect(SESSION_IDEA_HOLD_ENDS).toBe('2026-10-30');
    expect(sessionIdeaHoldActive(DURING)).toBe(true);
    expect(sessionIdeaHoldActive(AFTER)).toBe(false);
  });

  it('refuses an idea a session filed before the end date, saying why', () => {
    const reason = shapeHoldReason('claude', DURING);
    expect(reason).toMatch(/filed by a session/);
    expect(reason).toMatch(/30 October 2026/);
  });

  it('shapes the person\'s own ideas', () => {
    expect(shapeHoldReason('me', DURING)).toBeNull();
    expect(shapeHoldReason(null, DURING)).toBeNull();
  });

  it('lets a session idea through once the hold ends', () => {
    expect(shapeHoldReason('claude', AFTER)).toBeNull();
  });
});

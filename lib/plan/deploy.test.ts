import { describe, expect, it } from 'vitest';
import { DEPLOY_GRACE_MINUTES, deployStateFrom } from '@/lib/plan/deploy';

const NOW = Date.parse('2026-09-22T21:00:00.000Z');
const ago = (n: number) => new Date(NOW - n * 60_000).toISOString();

describe('deployStateFrom', () => {
  it('reads the statuses Vercel writes', () => {
    expect(deployStateFrom({ status: 'success', committedAt: ago(5), now: NOW })).toBe('deployed');
    expect(deployStateFrom({ status: 'failure', committedAt: ago(5), now: NOW })).toBe('failed');
    expect(deployStateFrom({ status: 'error', committedAt: ago(5), now: NOW })).toBe('failed');
    expect(deployStateFrom({ status: 'in_progress', committedAt: ago(5), now: NOW })).toBe(
      'deploying',
    );
    expect(deployStateFrom({ status: 'queued', committedAt: ago(5), now: NOW })).toBe('deploying');
  });

  // GitHub marks a deploy inactive when a newer one replaces it. It still went out.
  it('counts a replaced deploy as deployed', () => {
    expect(deployStateFrom({ status: 'inactive', committedAt: ago(90), now: NOW })).toBe(
      'deployed',
    );
  });

  it('waits out the grace period before calling a deploy missing', () => {
    const inside = ago(DEPLOY_GRACE_MINUTES - 1);
    const past = ago(DEPLOY_GRACE_MINUTES);
    expect(deployStateFrom({ status: null, committedAt: inside, now: NOW })).toBe('deploying');
    expect(deployStateFrom({ status: null, committedAt: past, now: NOW })).toBe('missing');
  });

  it('does not call a deploy missing when the commit time is unknown', () => {
    expect(deployStateFrom({ status: null, committedAt: null, now: NOW })).toBe('deploying');
    expect(deployStateFrom({ status: null, committedAt: 'not a date', now: NOW })).toBe(
      'deploying',
    );
  });
});

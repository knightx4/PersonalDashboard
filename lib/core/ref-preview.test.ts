import { describe, expect, it } from 'vitest';
import { isPreviewKey, parsePlanKey, planKey, previewKeyFromHref } from './ref-preview';
import { OPEN_PATH } from './refs';
import { planRefHref } from '@/lib/comments/refs';

/** What a ref link asks to preview, read from where it points (plan #1931.4). */
describe('previewKeyFromHref', () => {
  it('reads a ref opened through /open', () => {
    const ref = 'goals.items:7d8a3a0e-0000-4000-8000-000000000001';
    expect(previewKeyFromHref(`${OPEN_PATH}/${encodeURIComponent(ref)}`)).toBe(ref);
  });

  it('reads a step page by number or outline, as planRefHref writes it', () => {
    expect(previewKeyFromHref(planRefHref(1084))).toBe('#1084');
    expect(previewKeyFromHref(planRefHref('1490.11'))).toBe('#1490.11');
    expect(previewKeyFromHref('/dev/plan/1490.11?tab=steps#plan-2001')).toBe('#1490.11');
  });

  it('reads the plan filtered to one step, as older links point', () => {
    expect(previewKeyFromHref('/dev/plan?view=all&q=%231084#plan-1084')).toBe('#1084');
  });

  it('leaves everything else an ordinary link', () => {
    for (const href of [
      null,
      '',
      'https://example.com/dev/plan/12',
      '//dev/plan/12',
      '/dev/plan',
      '/dev/plan?q=marathon',
      '/dev/plan/picture',
      '/goals/all',
      `${OPEN_PATH}/not-a-ref`,
    ]) {
      expect(previewKeyFromHref(href)).toBeNull();
    }
  });
});

describe('plan keys', () => {
  it('round-trips a number and an outline', () => {
    expect(parsePlanKey(planKey(1084))).toEqual({ number: 1084 });
    expect(parsePlanKey(planKey('1490.11'))).toEqual({ outline: '1490.11' });
    expect(parsePlanKey('1490')).toBeNull();
  });

  it('answers only what the server can read', () => {
    expect(isPreviewKey('#1490.11')).toBe(true);
    expect(isPreviewKey('public.plan_items:abc')).toBe(true);
    expect(isPreviewKey('drop table')).toBe(false);
  });
});

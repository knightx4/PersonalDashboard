/**
 * The fuse's colour, which now comes from `lib/health.ts` rather than from a
 * `daysLeft <= 7` test of its own. This pins the three colours the bar drew
 * before that move so the refactor cannot quietly repaint a returns list.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReturnFuse } from '@/components/ui/return-fuse';

const fuse = (daysLeft: number | null, windowDays: number | null) =>
  renderToStaticMarkup(
    <ReturnFuse daysLeft={daysLeft} windowDays={windowDays} deadline="2026-10-01" />,
  );

describe('ReturnFuse', () => {
  it('draws a window with plenty left in ghost ink', () => {
    expect(fuse(30, 30)).toContain('bg-ink-ghost');
  });

  it('draws the last week in caution', () => {
    expect(fuse(7, 30)).toContain('bg-caution');
  });

  it('draws a passed deadline in danger, and full', () => {
    const markup = fuse(-1, 30);
    expect(markup).toContain('bg-danger');
    expect(markup).toContain('width:100%');
  });

  it('draws nothing without a window', () => {
    expect(fuse(5, null)).toBe('');
  });
});

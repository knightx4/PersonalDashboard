/**
 * The flight helper, checked without a browser.
 *
 * Its done-when is three claims: under 600ms, no layout change, and nothing
 * at all under reduced motion. The first two are claims about the keyframes
 * and options it hands to element.animate, so a stub element records them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLY_CHIP_MS, chipLabel, flightKeyframes, flyChip } from '@/components/ui/fly-chip';

type Recorded = { keyframes: Keyframe[]; options: KeyframeAnimationOptions };

function stubBrowser(reduced: boolean) {
  const recorded: Recorded[] = [];
  const appended: unknown[] = [];
  const removed: unknown[] = [];
  const makeChip = () => {
    const chip = {
      className: '',
      textContent: '',
      style: {} as Record<string, string>,
      offsetWidth: 80,
      offsetHeight: 20,
      setAttribute: vi.fn(),
      remove: () => removed.push(chip),
      animate: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
        recorded.push({ keyframes, options });
        return { finished: Promise.resolve() };
      },
    };
    return chip;
  };
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({ matches: reduced && query.includes('reduce') }),
  });
  vi.stubGlobal('document', {
    createElement: makeChip,
    body: { appendChild: (el: unknown) => appended.push(el) },
  });
  return { recorded, appended, removed };
}

const rect = (left: number, top: number, width = 100, height = 30) =>
  ({ left, top, width, height }) as DOMRectReadOnly;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chipLabel', () => {
  it('keeps the first four words and marks the cut', () => {
    expect(chipLabel('Ring the dentist about the appointment')).toBe('Ring the dentist about…');
  });
  it('leaves a short label alone', () => {
    expect(chipLabel('  buy  milk ')).toBe('buy milk');
  });
  it('cuts a long run of characters', () => {
    expect(chipLabel('a'.repeat(50))).toBe(`${'a'.repeat(32)}…`);
  });
});

describe('flightKeyframes', () => {
  it('animates transform and opacity only, centre to centre', () => {
    const frames = flightKeyframes(rect(0, 0), rect(500, 300), { width: 80, height: 20 });
    for (const frame of frames) {
      expect(Object.keys(frame).sort()).toEqual(['offset', 'opacity', 'transform']);
    }
    expect(frames[0].transform).toContain('translate(10px, 5px)');
    expect(frames.at(-1)?.transform).toContain('translate(510px, 305px)');
  });
});

describe('flyChip', () => {
  it('flies a chip in under 600ms and removes it when it lands', async () => {
    const browser = stubBrowser(false);
    await flyChip({ from: rect(0, 0), to: rect(400, 200), label: 'File this somewhere' });
    expect(FLY_CHIP_MS).toBeLessThan(600);
    expect(browser.recorded).toHaveLength(1);
    expect(browser.recorded[0].options.duration).toBe(FLY_CHIP_MS);
    expect(browser.appended).toHaveLength(1);
    expect(browser.removed).toEqual(browser.appended);
  });

  it('does nothing under reduced motion', async () => {
    const browser = stubBrowser(true);
    await flyChip({ from: rect(0, 0), to: rect(400, 200), label: 'File this somewhere' });
    expect(browser.appended).toHaveLength(0);
    expect(browser.recorded).toHaveLength(0);
  });

  it('does nothing when an end has no size', async () => {
    const browser = stubBrowser(false);
    await flyChip({ from: rect(0, 0, 0, 0), to: rect(400, 200), label: 'File this' });
    expect(browser.appended).toHaveLength(0);
  });

  it('resolves outside a browser', async () => {
    await expect(
      flyChip({ from: rect(0, 0), to: rect(1, 1), label: 'x' }),
    ).resolves.toBeUndefined();
  });
});

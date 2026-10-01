/**
 * The puff helper, checked without a browser.
 *
 * Its done-when: it plays from any point in under 400ms and is absent under
 * reduced motion. The keyframes are CSS, so a stub document records what
 * puffAt appends and removes, and the CSS is read for its duration and its
 * reduced-motion entry.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PUFF_MS, puffAt, puffOffsets, puffOrigin } from '@/components/ui/puff';

type Stub = {
  className: string;
  style: Record<string, string> & { setProperty: (k: string, v: string) => void };
  children: Stub[];
  setAttribute: (k: string, v: string) => void;
  appendChild: (el: Stub) => void;
  remove: () => void;
};

function stubBrowser(reduced: boolean) {
  const appended: Stub[] = [];
  const removed: Stub[] = [];
  const make = (): Stub => {
    const el: Stub = {
      className: '',
      style: Object.assign({} as Record<string, string>, {
        setProperty(k: string, v: string) {
          el.style[k] = v;
        },
      }) as Stub['style'],
      children: [],
      setAttribute: vi.fn(),
      appendChild: (child) => el.children.push(child),
      remove: () => removed.push(el),
    };
    return el;
  };
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({ matches: reduced && query.includes('reduce') }),
  });
  vi.stubGlobal('document', {
    createElement: make,
    body: { appendChild: (el: Stub) => appended.push(el) },
  });
  return { appended, removed };
}

const rect = (left: number, top: number, width = 100, height = 30) =>
  ({ left, top, width, height, x: left, y: top }) as DOMRectReadOnly;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('puffOrigin', () => {
  it('takes a point as it is', () => {
    expect(puffOrigin({ x: 12, y: 34 })).toEqual({ x: 12, y: 34 });
  });
  it('takes the centre of a rect', () => {
    expect(puffOrigin(rect(100, 200))).toEqual({ x: 150, y: 215 });
  });
  it('gives nothing for a rect with no size', () => {
    expect(puffOrigin(rect(100, 200, 0, 0))).toBeNull();
  });
});

describe('puffOffsets', () => {
  it('spreads the circles round the point, the first straight up', () => {
    const offsets = puffOffsets(4, 10);
    expect(offsets).toEqual([
      { dx: 0, dy: -10 },
      { dx: 10, dy: 0 },
      { dx: 0, dy: 10 },
      { dx: -10, dy: 0 },
    ]);
  });
});

describe('puffAt', () => {
  it('plays at a point in under 400ms and removes itself', async () => {
    vi.useFakeTimers();
    const browser = stubBrowser(false);
    const done = puffAt({ x: 40, y: 60 });
    expect(browser.appended).toHaveLength(1);
    const puff = browser.appended[0];
    expect(puff.className).toContain('pointer-events-none');
    expect(puff.className).toContain('fixed');
    expect(puff.className).toContain('z-toast');
    expect(puff.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true');
    expect(puff.style.left).toBe('40px');
    expect(puff.style.top).toBe('60px');
    expect(puff.children.length).toBeGreaterThan(2);
    for (const dot of puff.children) {
      expect(dot.className).toBe('puff');
      expect(dot.style['--puff-dx']).toMatch(/px$/);
    }
    expect(browser.removed).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(PUFF_MS + 40);
    await done;
    expect(browser.removed).toEqual([puff]);
    expect(PUFF_MS).toBeLessThan(400);
  });

  it('does nothing under reduced motion', async () => {
    const browser = stubBrowser(true);
    await puffAt({ x: 40, y: 60 });
    expect(browser.appended).toHaveLength(0);
  });

  it('does nothing for a rect with no size', async () => {
    const browser = stubBrowser(false);
    await puffAt(rect(0, 0, 0, 0));
    expect(browser.appended).toHaveLength(0);
  });

  it('resolves outside a browser', async () => {
    await expect(puffAt({ x: 1, y: 1 })).resolves.toBeUndefined();
  });
});

describe('the puff keyframes', () => {
  const css = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

  it('run for PUFF_MS', () => {
    const utility = css.match(/@utility puff \{[^}]*\}/)?.[0] ?? '';
    expect(utility).toContain(`animation: puff ${PUFF_MS}ms`);
  });

  it('are entered in the reduced-motion block', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/\.puff \{\s*display: none;/);
  });
});

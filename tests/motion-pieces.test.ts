/**
 * The shared motion pieces (plan #1550), checked without a browser: settleIn
 * springs on the tokens and does nothing under reduced motion, and
 * sendToPlace plays leave, travel and settle in capture's order.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EASE, MOTION_MS } from '@/lib/motion';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('@/components/motion/clear');
  vi.doUnmock('@/components/motion/travel');
  vi.doUnmock('@/components/motion/settle');
  vi.resetModules();
});

function stubWindow(reduced: boolean) {
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({ matches: reduced && query.includes('reduce') }),
  });
}

describe('settleIn', () => {
  it('springs the element in over one move', async () => {
    stubWindow(false);
    const { settleIn, SETTLE_IN_KEYFRAMES } = await import('@/components/motion/settle');
    const animate = vi.fn(() => ({ finished: Promise.resolve() }));
    await settleIn({ animate } as unknown as Element);
    expect(animate).toHaveBeenCalledWith(SETTLE_IN_KEYFRAMES, {
      duration: MOTION_MS.move,
      easing: EASE.spring,
    });
    expect(SETTLE_IN_KEYFRAMES.at(-1)).toEqual({ transform: 'none', opacity: 1 });
  });

  it('leaves the element as it is under reduced motion', async () => {
    stubWindow(true);
    const { settleIn } = await import('@/components/motion/settle');
    const animate = vi.fn();
    await settleIn({ animate } as unknown as Element);
    expect(animate).not.toHaveBeenCalled();
  });
});

describe('sendToPlace', () => {
  async function load() {
    const calls: string[] = [];
    vi.doMock('@/components/motion/clear', () => ({
      puffAt: () => {
        calls.push('puff');
        return Promise.resolve();
      },
    }));
    vi.doMock('@/components/motion/travel', () => ({
      travel: async () => {
        calls.push('travel');
      },
    }));
    vi.doMock('@/components/motion/settle', () => ({
      settle: (_: Element, name: string) => calls.push(`settle ${name}`),
    }));
    const { sendToPlace } = await import('@/components/motion/place');
    return { calls, sendToPlace };
  }

  const from = { left: 0, top: 0, width: 10, height: 10 } as DOMRectReadOnly;
  const to = {} as Element;

  it('puffs, travels, then settles with the name', async () => {
    const { calls, sendToPlace } = await load();
    await sendToPlace({ from, to, label: 'Buy milk', name: 'Todo · Today' });
    expect(calls).toEqual(['puff', 'travel', 'settle Todo · Today']);
  });

  it('only settles when there is nowhere it came from', async () => {
    const { calls, sendToPlace } = await load();
    await sendToPlace({ to, label: 'Buy milk', name: 'Todo · Today' });
    expect(calls).toEqual(['settle Todo · Today']);
  });

  it('only puffs when there is no place on screen', async () => {
    const { calls, sendToPlace } = await load();
    await sendToPlace({ from, to: null, label: 'Buy milk', name: 'Todo · Today' });
    expect(calls).toEqual(['puff']);
  });
});

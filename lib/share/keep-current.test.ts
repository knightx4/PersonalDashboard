import { describe, expect, it, vi } from 'vitest';
import { keepCurrent, SHARE_REFRESH_MS } from './keep-current';

function harness() {
  const winL = new Map<string, () => void>();
  const docL = new Map<string, () => void>();
  let tick: (() => void) | null = null;
  let interval: number | null = null;
  const doc = {
    visibilityState: 'visible',
    addEventListener: (t: string, f: () => void) => void docL.set(t, f),
    removeEventListener: (t: string) => void docL.delete(t),
  };
  const win = {
    addEventListener: (t: string, f: () => void) => void winL.set(t, f),
    removeEventListener: (t: string) => void winL.delete(t),
    setInterval: (f: () => void, ms: number) => {
      tick = f;
      interval = ms;
      return 7;
    },
    clearInterval: (id: number) => {
      if (id === 7) tick = null;
    },
  };
  return {
    win,
    doc,
    winL,
    docL,
    fire: () => tick?.(),
    interval: () => interval,
    ticking: () => tick !== null,
  };
}

describe('keepCurrent', () => {
  it('refreshes on focus and when the tab becomes visible', () => {
    const h = harness();
    const refresh = vi.fn();
    keepCurrent(h.win as never, h.doc as never, refresh);
    h.winL.get('focus')!();
    expect(refresh).toHaveBeenCalledTimes(1);
    h.doc.visibilityState = 'hidden';
    h.docL.get('visibilitychange')!();
    expect(refresh).toHaveBeenCalledTimes(1);
    h.doc.visibilityState = 'visible';
    h.docL.get('visibilitychange')!();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('polls every minute while visible and skips ticks while hidden', () => {
    const h = harness();
    const refresh = vi.fn();
    keepCurrent(h.win as never, h.doc as never, refresh);
    expect(h.interval()).toBe(SHARE_REFRESH_MS);
    h.fire();
    expect(refresh).toHaveBeenCalledTimes(1);
    h.doc.visibilityState = 'hidden';
    h.fire();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('removes everything on cleanup', () => {
    const h = harness();
    const stop = keepCurrent(h.win as never, h.doc as never, vi.fn());
    stop();
    expect(h.winL.size).toBe(0);
    expect(h.docL.size).toBe(0);
    expect(h.ticking()).toBe(false);
  });
});

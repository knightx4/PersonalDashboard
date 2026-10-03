/**
 * The completion moment (plan #1552), checked without a browser: one 10ms
 * buzz where the browser can vibrate, nothing and no error where it cannot
 * (an iPhone), nothing once switched off, and one buzz for two completions
 * inside a move.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HAPTIC_MS, MOTION_MS } from '@/lib/motion';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

describe('completionMoment', () => {
  it('buzzes once for HAPTIC_MS where the browser can vibrate', async () => {
    stubStorage();
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate });
    const { completionMoment } = await import('@/components/motion/complete');
    completionMoment(1000);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_MS);
    expect(HAPTIC_MS).toBe(10);
  });

  it('does nothing and does not throw where there is no vibration, as on an iPhone', async () => {
    stubStorage();
    vi.stubGlobal('navigator', { userAgent: 'iPhone' });
    const { completionMoment, canBuzz } = await import('@/components/motion/complete');
    expect(canBuzz()).toBe(false);
    expect(() => completionMoment(1000)).not.toThrow();
  });

  it('does nothing outside a browser', async () => {
    const { completionMoment, buzzOnce } = await import('@/components/motion/complete');
    expect(buzzOnce()).toBe(false);
    expect(() => completionMoment(1000)).not.toThrow();
  });

  it('stays still once the switch is off, and buzzes again once it is on', async () => {
    const store = stubStorage();
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate });
    const { completionMoment, setHapticsOn, hapticsOn, HAPTICS_KEY } = await import(
      '@/components/motion/complete'
    );
    setHapticsOn(false);
    expect(store.get(HAPTICS_KEY)).toBe('off');
    expect(hapticsOn()).toBe(false);
    completionMoment(1000);
    expect(vibrate).not.toHaveBeenCalled();

    setHapticsOn(true);
    expect(hapticsOn()).toBe(true);
    completionMoment(5000);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('is on when storage cannot be read', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    const { hapticsOn } = await import('@/components/motion/complete');
    expect(hapticsOn()).toBe(true);
  });

  it('plays two completions inside a move as one moment', async () => {
    stubStorage();
    const vibrate = vi.fn(() => true);
    vi.stubGlobal('navigator', { vibrate });
    const { completionMoment } = await import('@/components/motion/complete');
    completionMoment(1000);
    completionMoment(1000 + MOTION_MS.move - 1);
    expect(vibrate).toHaveBeenCalledTimes(1);
    completionMoment(1000 + MOTION_MS.move);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('keeps playing the other effects when one throws', async () => {
    stubStorage();
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('not allowed');
      },
    });
    const { completionMoment } = await import('@/components/motion/complete');
    expect(() => completionMoment(1000)).not.toThrow();
  });
});

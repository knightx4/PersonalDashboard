/**
 * The completion moment (plan #1552), checked without a browser: one 10ms
 * buzz where the browser can vibrate, nothing and no error where it cannot
 * (an iPhone), nothing once switched off, and one buzz for two completions
 * inside a move.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLICK_MS, HAPTIC_MS, MOTION_MS } from '@/lib/motion';

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

/**
 * The click (plan #1553): an AudioContext that records what it plays, and a
 * fetch that hands back the file's bytes.
 */
function stubAudio() {
  const started = vi.fn();
  class FakeContext {
    state: 'suspended' | 'running' = 'suspended';
    destination = {};
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    decodeAudioData() {
      return Promise.resolve({ duration: CLICK_MS / 1000 });
    }
    createBufferSource() {
      return { buffer: null, connect: () => {}, start: started };
    }
  }
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
  );
  return started;
}

describe('the completion click', () => {
  it('is off by default, and nothing plays', async () => {
    stubStorage();
    const started = stubAudio();
    const { completionMoment, clickOn, primeClick } = await import('@/components/motion/complete');
    expect(clickOn()).toBe(false);
    primeClick();
    await new Promise((r) => setTimeout(r, 0));
    completionMoment(1000);
    expect(started).not.toHaveBeenCalled();
  });

  it('plays once for a completion with the switch on, and not at all once off', async () => {
    const store = stubStorage();
    const started = stubAudio();
    const { completionMoment, setClickOn, primeClick, CLICK_KEY } = await import(
      '@/components/motion/complete'
    );
    setClickOn(true);
    expect(store.get(CLICK_KEY)).toBe('on');
    await new Promise((r) => setTimeout(r, 0));
    // Switching it on plays it once, so the person hears what they chose.
    expect(started).toHaveBeenCalledTimes(1);

    primeClick();
    completionMoment(1000);
    expect(started).toHaveBeenCalledTimes(2);

    setClickOn(false);
    completionMoment(5000);
    expect(started).toHaveBeenCalledTimes(2);
  });

  it('is skipped rather than played late when the sound is not ready', async () => {
    stubStorage({ pt_click: 'on' });
    const started = stubAudio();
    const { completionMoment } = await import('@/components/motion/complete');
    completionMoment(1000);
    expect(started).not.toHaveBeenCalled();
  });

  it('does nothing outside a browser that can play sound', async () => {
    stubStorage({ pt_click: 'on' });
    const { clickOnce, canClick } = await import('@/components/motion/complete');
    expect(canClick()).toBe(false);
    expect(clickOnce()).toBe(false);
  });

  it('is a file shorter than 80ms, CLICK_MS long', () => {
    const wav = readFileSync(join(process.cwd(), 'public/sounds/click.wav'));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    const byteRate = wav.readUInt32LE(28);
    const dataBytes = wav.readUInt32LE(40);
    const ms = (dataBytes / byteRate) * 1000;
    expect(ms).toBeLessThan(80);
    expect(Math.round(ms)).toBe(CLICK_MS);
  });
});

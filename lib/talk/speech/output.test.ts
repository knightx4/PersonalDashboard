import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The browser's side of reading replies aloud, with iPhone Safari's rule
 * stood in for (plan #3036): sound starts only inside a press, and an element
 * or a context that has played inside one may play later without one.
 */

let pressing = false;
/** Whether Safari lets the context resume outside a press (it does not on iPhone). */
let resumesAnywhere = false;
let decodes = true;
const elements: FakeAudio[] = [];
const contexts: FakeContext[] = [];
const pressListeners: (() => void)[] = [];

class FakeAudio {
  src = '';
  preload = '';
  readyState = 4;
  paused = true;
  open = false;
  played: string[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    elements.push(this);
  }
  setAttribute() {}
  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }
  addEventListener() {}
  removeEventListener() {}
  load() {}
  play() {
    if (!pressing && !this.open) return Promise.reject(new Error('NotAllowedError'));
    this.open = true;
    this.paused = false;
    this.played.push(this.src);
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

class FakeContext {
  state: 'suspended' | 'running' | 'interrupted' = 'suspended';
  currentTime = 0;
  destination = {};
  silentStarts = 0;
  clipStarts = 0;
  constructor() {
    contexts.push(this);
  }
  resume() {
    if (pressing || resumesAnywhere) this.state = 'running';
    return Promise.resolve();
  }
  createBuffer(_channels: number, length: number) {
    return { length, duration: length / 22050 };
  }
  createBufferSource() {
    const source = {
      buffer: null as { length: number } | null,
      onended: null as (() => void) | null,
      connect: () => {},
      disconnect: () => {},
      stop: () => {},
      start: () => {
        if (source.buffer?.length === 1) this.silentStarts += 1;
        else this.clipStarts += 1;
      },
    };
    return source;
  }
  decodeAudioData(_data: ArrayBuffer, ok: (b: unknown) => void, fail: (e: unknown) => void) {
    if (decodes) ok({ length: 22050, duration: 1 });
    else fail(new Error('cannot decode'));
    return undefined;
  }
}

async function load() {
  vi.resetModules();
  return import('./output');
}

/** Runs `fn` as Safari would inside a press. */
function press(fn: () => void) {
  pressing = true;
  try {
    fn();
  } finally {
    pressing = false;
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const mp3 = () => new Blob(['mp3'], { type: 'audio/mpeg' });

beforeEach(() => {
  pressing = false;
  resumesAnywhere = false;
  decodes = true;
  elements.length = 0;
  contexts.length = 0;
  pressListeners.length = 0;
  vi.stubGlobal('window', { AudioContext: FakeContext });
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('document', { addEventListener: (_event: string, listener: () => void) => pressListeners.push(listener) });
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:clip-${(n += 1)}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('opening the sound inside a press', () => {
  it('plays a silent clip through one element and pauses it, and starts the context with a silent sample', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const output = await load();
    press(() => output.unlockSpeechOutput());
    await settle();
    expect(elements).toHaveLength(1);
    expect(elements[0].played).toEqual([expect.stringMatching(/^data:audio\/wav;base64,/)]);
    expect(elements[0].paused).toBe(true);
    expect(contexts[0].state).toBe('running');
    expect(contexts[0].silentStarts).toBe(1);
    expect(output.speechUnlocked()).toBe(true);
    // The silent clip is made here: nothing is asked of /api/speak, nothing counts against the month.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('makes a silent clip that is a WAV', async () => {
    const output = await load();
    const bytes = atob(output.silentClip().split(',')[1]);
    expect(bytes.slice(0, 4)).toBe('RIFF');
    expect(bytes.slice(8, 12)).toBe('WAVE');
    expect(bytes.length).toBe(44 + 800);
  });

  it('plays a reply that arrives seconds after the send press without another press', async () => {
    const output = await load();
    press(() => output.unlockSpeechOutput());
    await settle();
    const { audio } = output.clipOf(mp3());
    await expect(audio.play()).resolves.toBeUndefined();
    expect(contexts[0].clipStarts).toBe(1);
  });

  it('opens the sound on any press on the page once the thread is listening', async () => {
    const output = await load();
    output.listenForUnlock();
    expect(pressListeners.length).toBeGreaterThan(0);
    press(() => pressListeners[0]());
    await settle();
    expect(output.speechUnlocked()).toBe(true);
    expect(elements[0].open).toBe(true);
  });
});

describe('every clip through the one element', () => {
  it('swaps the src of the same element for each clip it plays, never making another', async () => {
    decodes = false;
    const output = await load();
    press(() => output.unlockSpeechOutput());
    await settle();
    const first = output.clipOf(mp3());
    await first.audio.play();
    first.release();
    const second = output.clipOf(mp3());
    await second.audio.play();
    const sample = output.linkClip('https://example.test/sample.mp3');
    second.release();
    await sample.audio.play();
    expect(elements).toHaveLength(1);
    expect(elements[0].played.slice(1)).toEqual(['blob:clip-1', 'blob:clip-2', 'https://example.test/sample.mp3']);
  });

  it('plays through the open element when Safari has shut the context since the press', async () => {
    const output = await load();
    press(() => output.unlockSpeechOutput());
    await settle();
    contexts[0].state = 'interrupted';
    const { audio } = output.clipOf(mp3());
    await expect(audio.play()).resolves.toBeUndefined();
    expect(elements[0].played.at(-1)).toBe('blob:clip-1');
  });

  it('does not stop the next clip when an earlier one is released late', async () => {
    decodes = false;
    const output = await load();
    press(() => output.unlockSpeechOutput());
    await settle();
    const first = output.clipOf(mp3());
    await first.audio.play();
    const second = output.clipOf(mp3());
    await second.audio.play();
    first.release();
    first.audio.pause();
    expect(elements[0].src).toBe('blob:clip-2');
    expect(elements[0].paused).toBe(false);
  });
});

describe('when no press has opened the sound', () => {
  it('throws, so the player shows the play press', async () => {
    const output = await load();
    const { audio } = output.clipOf(mp3());
    await expect(audio.play()).rejects.toThrow('NotAllowedError');
    expect(output.speechUnlocked()).toBe(false);
  });

  it('plays the rest after one press on the prompt', async () => {
    const output = await load();
    await expect(output.clipOf(mp3()).audio.play()).rejects.toThrow();
    press(() => output.unlockSpeechOutput());
    await settle();
    await expect(output.clipOf(mp3()).audio.play()).resolves.toBeUndefined();
    await expect(output.clipOf(mp3()).audio.play()).resolves.toBeUndefined();
  });
});

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
/** Whether the context's clock stands still while it says it runs, as iPhone Safari's can (plan #3068). */
let contextFrozen = false;
/** Whether the element's time stands still after it says it plays. */
let elementFrozen = false;
/** Whether the element refuses to play at all, as a clip Safari cannot read. */
let elementRefuses = false;
const elements: FakeAudio[] = [];
const contexts: FakeContext[] = [];
const pressListeners: (() => void)[] = [];

class FakeAudio {
  src = '';
  preload = '';
  readyState = 4;
  paused = true;
  ended = false;
  open = false;
  played: string[] = [];
  time = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onplaying: (() => void) | null = null;
  onpause: (() => void) | null = null;
  get currentTime() {
    if (!this.paused && !elementFrozen) this.time += 0.02;
    return this.time;
  }
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
    if (elementRefuses) return Promise.reject(Object.assign(new Error('not supported'), { name: 'NotSupportedError' }));
    if (!pressing && !this.open) return Promise.reject(new Error('NotAllowedError'));
    this.open = true;
    this.paused = false;
    this.played.push(this.src);
    this.onplaying?.();
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

class FakeContext {
  state: 'suspended' | 'running' | 'interrupted' = 'suspended';
  time = 0;
  get currentTime() {
    if (this.state === 'running' && !contextFrozen) this.time += 0.02;
    return this.time;
  }
  destination = {};
  silentStarts = 0;
  clipStarts = 0;
  clipStops = 0;
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
      stop: () => {
        if (source.buffer?.length !== 1) this.clipStops += 1;
      },
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
  contextFrozen = false;
  elementFrozen = false;
  elementRefuses = false;
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
    expect(bytes.length).toBe(44 + 2205 * 2);
    // 16-bit samples, which every Safari plays.
    expect(bytes.charCodeAt(34)).toBe(16);
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

describe('a clip counts as playing only once its clock moves (plan #3068)', () => {
  it('plays through the open element when the context says it runs but its clock stands still, and keeps to the element', async () => {
    const output = await load();
    const failures: { stage: string; name: string }[] = [];
    output.onSpeechFailure((failure) => failures.push(failure));
    press(() => output.unlockSpeechOutput());
    await settle();
    contextFrozen = true;
    const first = output.clipOf(mp3());
    await expect(first.audio.play()).resolves.toBeUndefined();
    expect(contexts[0].clipStarts).toBe(1);
    expect(contexts[0].clipStops).toBe(1);
    expect(elements[0].played.at(-1)).toBe('blob:clip-1');
    expect(failures).toEqual([expect.objectContaining({ stage: 'play', name: 'StalledError' })]);
    expect(output.speechOutputState()).toMatchObject({ context: 'running', contextStalled: true, elementOpen: true });
    first.release();
    // The next clip goes straight to the element, with no second wait on a silent context.
    const second = output.clipOf(mp3());
    await second.audio.play();
    expect(contexts[0].clipStarts).toBe(1);
    expect(elements[0].played.at(-1)).toBe('blob:clip-2');
  });

  it('throws when the clock stands still and no element is open, so the player shows the play press', async () => {
    elementRefuses = true;
    const output = await load();
    const failures: { stage: string; name: string }[] = [];
    output.onSpeechFailure((failure) => failures.push(failure));
    press(() => output.unlockSpeechOutput());
    await settle();
    expect(failures).toEqual([expect.objectContaining({ stage: 'unlock', name: 'NotSupportedError' })]);
    contextFrozen = true;
    vi.useFakeTimers();
    try {
      const caught = output
        .clipOf(mp3())
        .audio.play()
        .then(
          () => null,
          (error: Error) => error,
        );
      await vi.advanceTimersByTimeAsync(2000);
      expect((await caught)?.name).toBe('StalledError');
      expect(contexts[0].clipStops).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws StalledError when the element says it plays but its time stands still', async () => {
    decodes = false;
    const output = await load();
    press(() => output.unlockSpeechOutput());
    await settle();
    elementFrozen = true;
    vi.useFakeTimers();
    try {
      const caught = output
        .clipOf(mp3())
        .audio.play()
        .then(
          () => null,
          (error: Error) => error,
        );
      await vi.advanceTimersByTimeAsync(2000);
      expect((await caught)?.name).toBe('StalledError');
      expect(elements[0].paused).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('calls onerror with held when Safari pauses the element part way', async () => {
    decodes = false;
    const output = await load();
    press(() => output.unlockSpeechOutput());
    await settle();
    const { audio } = output.clipOf(mp3());
    const errors: (boolean | undefined)[] = [];
    audio.onerror = (held) => errors.push(held);
    await audio.play();
    elements[0].paused = true;
    elements[0].onpause?.();
    expect(errors).toEqual([true]);
  });

  it('calls onerror with held when the context stops part way through a clip', async () => {
    const output = await load();
    press(() => output.unlockSpeechOutput());
    await settle();
    vi.useFakeTimers();
    try {
      const { audio } = output.clipOf(mp3());
      const errors: (boolean | undefined)[] = [];
      audio.onerror = (held) => errors.push(held);
      await audio.play();
      contexts[0].state = 'interrupted';
      await vi.advanceTimersByTimeAsync(600);
      expect(errors).toEqual([true]);
      expect(contexts[0].clipStops).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The browser's side of reading replies aloud (plan #3028): how a bubble's
 * MP3 reaches the speaker, for the player in lib/talk/speech/player.ts.
 *
 * Each clip is decoded whole and played through one Web Audio context, not a
 * fresh <audio> element per bubble. An element told to play before it has
 * buffered, or a speaker waking from silence, loses the first syllables; a
 * decoded clip starts on its first sample, and it is started a moment ahead
 * (WAKE_LEAD_S) when nothing has sounded for a while, so the output is awake
 * before the first word. One context, unlocked once by a press, also lets
 * iPhone Safari play bubbles that arrive later with no press of their own,
 * which a new element per bubble does not get.
 *
 * Safari only lets sound start from inside a press, and a reply arrives
 * seconds after the send press, when Safari no longer counts it (plan #3036).
 * So the sound is opened inside the press itself, never after an await:
 * `unlockSpeechOutput` resumes the context and starts a one-sample silent
 * buffer, and plays a silent WAV through the page's one <audio> element and
 * pauses it. The chat's send press and Enter call it, and `listenForUnlock`
 * calls it on every other press on the page while either is still shut, so
 * one tap anywhere keeps the sound open. It also asks the phone to treat this
 * as playback, so the ring/silent switch does not mute it.
 *
 * That one element, never a new one per bubble (a new element is shut again
 * on iOS), plays a clip Web Audio cannot decode, a voice's sample at a link,
 * and a bubble whose context Safari will not resume (after the phone was
 * locked, say) while the element is still open: each swaps in its own src.
 * A clip that neither can play throws, and the player falls back to the play
 * press. The silent clip is built here and never asks /api/speak for anything.
 *
 * A clip counts as playing only once its clock moves (plan #3068): the
 * context's currentTime after the source starts, or the element's
 * currentTime after its `playing` event. iPhone Safari can report a context
 * as running while nothing renders, and then a started source never ends
 * and the chat said "speaking" over silence. A context whose clock stays
 * still for STALL_MS is marked stalled and the clip, and every clip after it
 * on this page, goes through the element a press opened; with no open
 * element the clip throws and the player shows the play press. A clip that
 * stops sounding part way (a call, another app taking the sound) calls its
 * `onerror` with `held`, which shows the same press. Each such failure is
 * handed to the reporter `onSpeechFailure` sets, with what the context and
 * the element were doing, so a silent phone can be read about afterwards.
 */

import type { SpeechAudio } from './player';

/** How long before the first clip after a quiet spell it is started, for the speaker to wake. */
const WAKE_LEAD_S = 0.25;
/** The lead for a clip that follows another closely. */
const NEXT_LEAD_S = 0.03;
/** Silence longer than this counts as a quiet spell. */
const QUIET_AFTER_S = 1.5;
/** How long a resume is given before the clip is counted as held back. */
const RESUME_WAIT_MS = 1500;
/** How long an <audio> element is given to buffer before it plays anyway. */
const BUFFER_WAIT_MS = 6000;
/** How long a started clip's clock is given to move before the clip counts as silent. */
const STALL_MS = 1500;
/** How often a clip's clock is read while it is checked. */
const POLL_MS = 50;
/** How often a sounding clip's clock is read for a stop part way. */
const WATCH_MS = 500;

type AudioContextCtor = new () => AudioContext;

let context: AudioContext | null = null;
/** The page's one <audio> element, shared by every bubble and every bot. */
let element: HTMLAudioElement | null = null;
/** Whether the element has played inside a press, after which Safari lets it play later. */
let elementOpen = false;
/** Whether the silent clip is on its way. */
let opening = false;
/** The clip playing through the element now, so a clip released late does not stop the next. */
let elementOwner: object | null = null;
/** When, on the context's clock, the last clip stops sounding. */
let soundingUntil = Number.NEGATIVE_INFINITY;
/** Whether the context said it was running while its clock stood still; the element plays from then on. */
let contextStalled = false;

/** One thing that kept a clip from sounding, for the log. */
export type SpeechOutputFailure = { stage: string; name: string; message: string };

let reporter: ((failure: SpeechOutputFailure) => void) | null = null;

/** Where failures the player never hears of (a stall the element covered, an unlock refused) are sent. */
export function onSpeechFailure(report: ((failure: SpeechOutputFailure) => void) | null): void {
  reporter = report;
}

function report(stage: string, name: string, message: string) {
  try {
    reporter?.({ stage, name, message });
  } catch {
    /* The log never stops the sound. */
  }
}

/** An error whose name the player logs: NotAllowedError, StalledError. The message starts with the name. */
function failure(name: string, why: string): Error {
  const error = new Error(`${name}: ${why}`);
  error.name = name;
  return error;
}

/** What the sound is doing now, for a failure's log line. */
export function speechOutputState(): Record<string, string | boolean | number | null> {
  let session: string | null = null;
  try {
    session = (navigator as unknown as { audioSession?: { type: string; state?: string } }).audioSession?.type ?? null;
  } catch {
    session = null;
  }
  return {
    context: context?.state ?? null,
    contextStalled,
    elementOpen,
    elementPaused: element ? element.paused : null,
    elementReady: element ? element.readyState : null,
    audioSession: session,
  };
}

/**
 * Resolves true once `read` moves past where it was, or once `settled` says
 * the clip was stopped or has ended; false when STALL_MS passes first.
 */
function clockMoves(read: () => number, settled: () => boolean, ready: () => boolean = () => true): Promise<boolean> {
  const from = read();
  const begun = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (settled()) return resolve(true);
      if (ready() && read() > from) return resolve(true);
      if (Date.now() - begun >= STALL_MS) return resolve(false);
      setTimeout(tick, POLL_MS);
    };
    tick();
  });
}

function theContext(): AudioContext | null {
  if (context) return context;
  if (typeof window === 'undefined') return null;
  const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as
    | AudioContextCtor
    | undefined;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

function theElement(): HTMLAudioElement | null {
  if (element) return element;
  if (typeof Audio === 'undefined') return null;
  try {
    element = new Audio();
  } catch {
    return null;
  }
  element.preload = 'auto';
  element.setAttribute('playsinline', '');
  return element;
}

/**
 * A tenth of a second of silence as a 16-bit WAV at 22,050 a second, a rate
 * and depth every Safari plays, made here so opening the sound costs no
 * request.
 */
export function silentClip(): string {
  const rate = 22050;
  const samples = Math.round(rate / 10);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, word: string) => {
    for (let i = 0; i < word.length; i += 1) bytes[at + i] = word.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes a second at two bytes a sample
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true); // 16-bit silence is zero, as the array starts
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

let silence: string | null = null;

/** Plays the silent clip through the element and pauses it, so Safari lets it play later. */
function openElement() {
  if (elementOpen || opening || elementOwner) return;
  const el = theElement();
  if (!el) return;
  opening = true;
  silence ??= silentClip();
  el.src = silence;
  let played: Promise<void> | undefined;
  try {
    played = el.play();
  } catch (error) {
    opening = false;
    report('unlock', errorName(error), errorMessage(error));
    return;
  }
  void Promise.resolve(played).then(
    () => {
      opening = false;
      elementOpen = true;
      if (!elementOwner) el.pause();
    },
    (error: unknown) => {
      opening = false;
      report('unlock', errorName(error), errorMessage(error));
    },
  );
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a press has opened the sound for replies that arrive later. */
export function speechUnlocked(): boolean {
  return elementOpen || context?.state === 'running';
}

/** Safari 17 and later: speech is playback, heard with the silent switch on. */
function askForPlayback() {
  try {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== 'playback') session.type = 'playback';
  } catch {
    /* Not offered here. */
  }
}

/**
 * Opens the sound from inside a press: resumes the context and starts a
 * silent sample, and plays the silent clip through the element, which is
 * what iPhone Safari counts as the page being allowed to play. Call it in
 * the press's own handler, before any await. Cheap when already open.
 */
export function unlockSpeechOutput(): void {
  listenForUnlock();
  askForPlayback();
  openElement();
  const ctx = theContext();
  if (!ctx || ctx.state === 'running') return;
  void ctx.resume().catch(() => {});
  try {
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, 22050);
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    /* The resume alone will do. */
  }
}

let listening = false;

/** Opens the sound on the page's presses while the context or the element is shut. Installed once. */
export function listenForUnlock(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  const unlock = () => {
    if (context?.state !== 'running' || !elementOpen) unlockSpeechOutput();
  };
  for (const event of ['touchend', 'click', 'keydown'] as const) {
    document.addEventListener(event, unlock, { capture: true, passive: true });
  }
}

async function running(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === 'running') return true;
  // Safari leaves a resume outside a press pending, so it is not waited on for ever.
  await Promise.race([ctx.resume().catch(() => {}), new Promise((resolve) => setTimeout(resolve, RESUME_WAIT_MS))]);
  return (ctx.state as string) === 'running';
}

function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // Older Safari answers only through the callbacks.
  return new Promise((resolve, reject) => {
    const promised = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    promised?.then(resolve, reject);
  });
}

function canPlayThrough(element: HTMLAudioElement): Promise<void> {
  if (element.readyState >= 4) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      element.removeEventListener('canplaythrough', done);
      element.removeEventListener('error', done);
      resolve();
    };
    const timer = setTimeout(done, BUFFER_WAIT_MS);
    element.addEventListener('canplaythrough', done);
    element.addEventListener('error', done);
    element.load();
  });
}

/**
 * Plays `src` through the page's one element, for `audio`'s handlers: the
 * src is swapped in, never a new element made. Throws when there is no
 * element or Safari still holds it shut.
 */
function throughElement(src: string, audio: SpeechAudio, owner: object, isStopped: () => boolean): Promise<void> {
  const el = theElement();
  if (!el) return Promise.reject(failure('NotAllowedError', 'there is no audio element'));
  elementOwner = owner;
  let sawPlaying = false;
  /** Set before the element is paused here, so only Safari's own pause counts as a stop part way. */
  let pausedHere = false;
  const gone = () => isStopped() || elementOwner !== owner;
  el.onended = () => {
    if (elementOwner === owner) audio.onended?.();
  };
  el.onerror = () => {
    if (elementOwner === owner) audio.onerror?.();
  };
  el.onplaying = () => {
    if (elementOwner === owner) sawPlaying = true;
  };
  el.onpause = null;
  el.src = src;
  return canPlayThrough(el).then(async () => {
    if (gone()) return;
    await el.play();
    elementOpen = true;
    // Safari pauses the element itself when a call or another app takes the sound.
    el.onpause = () => {
      if (pausedHere || gone() || el.ended) return;
      report('playback', 'Interrupted', 'the audio element was paused part way');
      audio.onerror?.(true);
    };
    const moving = await clockMoves(() => el.currentTime, () => gone() || el.ended, () => sawPlaying && !el.paused);
    if (gone() || moving) return;
    pausedHere = true;
    el.pause();
    throw failure('StalledError', `the audio element played but ${sawPlaying ? 'its time did not move' : 'never said it was playing'} (ready ${el.readyState})`);
  });
}

function pauseElement(owner: object) {
  if (elementOwner === owner) element?.pause();
}

/** Lets the element go, leaving it open for the next clip. */
function releaseElement(owner: object) {
  if (elementOwner !== owner || !element) return;
  elementOwner = null;
  element.onended = null;
  element.onerror = null;
  element.onplaying = null;
  element.onpause = null;
  element.pause();
  element.removeAttribute('src');
}

/** Plays a recording at a link (a voice's sample) through the page's one element. */
export function linkClip(url: string): { audio: SpeechAudio; release: () => void } {
  const owner = {};
  let stopped = false;
  const audio: SpeechAudio = {
    onended: null,
    onerror: null,
    play: () => throughElement(url, audio, owner, () => stopped),
    pause: () => {
      stopped = true;
      pauseElement(owner);
    },
  };
  return { audio, release: () => releaseElement(owner) };
}

/** Plays a bubble's MP3 from its first word. */
export function clipOf(blob: Blob): { audio: SpeechAudio; release: () => void } {
  let source: AudioBufferSourceNode | null = null;
  let url: string | null = null;
  let stopped = false;
  let watch: ReturnType<typeof setInterval> | null = null;
  const owner = {};

  const unwatch = () => {
    if (watch) clearInterval(watch);
    watch = null;
  };

  const hush = (node: AudioBufferSourceNode, ctx: AudioContext) => {
    try {
      node.stop();
    } catch {
      /* Already stopped. */
    }
    node.disconnect();
    if (source === node) source = null;
    soundingUntil = Math.min(soundingUntil, ctx.currentTime);
  };

  /** Reads the context's clock while the clip sounds, for a context Safari stops part way. */
  const watchClock = (ctx: AudioContext, node: AudioBufferSourceNode) => {
    let last = ctx.currentTime;
    let still = 0;
    watch = setInterval(() => {
      if (stopped || source !== node) return unwatch();
      const nowAt = ctx.currentTime;
      still = nowAt > last ? 0 : still + WATCH_MS;
      last = nowAt;
      if (ctx.state === 'running' && still < STALL_MS) return;
      unwatch();
      contextStalled = true;
      report('playback', 'Interrupted', `the audio context went ${ctx.state} part way through a clip`);
      hush(node, ctx);
      audio.onerror?.(true);
    }, WATCH_MS);
  };

  const viaElement = () => {
    url ??= URL.createObjectURL(blob);
    return throughElement(url, audio, owner, () => stopped);
  };

  const audio: SpeechAudio = {
    onended: null,
    onerror: null,
    play: async () => {
      const ctx = theContext();
      if (!ctx) return viaElement();
      if ((ctx.state !== 'running' || contextStalled) && elementOpen) {
        // Safari shut the context (the phone was locked, another app took the sound), or ran it in silence, but the element a press opened still plays.
        if (ctx.state !== 'running') void ctx.resume().catch(() => {});
        return viaElement();
      }
      if (!(await running(ctx))) throw failure('NotAllowedError', `the audio context stayed ${ctx.state}`);
      let buffer: AudioBuffer;
      try {
        buffer = await decode(ctx, await blob.arrayBuffer());
      } catch {
        return viaElement();
      }
      if (stopped) return;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      let ended = false;
      node.onended = () => {
        ended = true;
        unwatch();
        if (!stopped && source === node) audio.onended?.();
      };
      const quiet = ctx.currentTime > soundingUntil + QUIET_AFTER_S;
      const at = ctx.currentTime + (quiet ? WAKE_LEAD_S : NEXT_LEAD_S);
      node.start(at);
      soundingUntil = at + buffer.duration;
      source = node;
      // Running is not sounding: on iPhone the clock is the only sign the context renders.
      const moving = await clockMoves(() => ctx.currentTime, () => stopped || ended);
      if (stopped || ended) return;
      if (moving) {
        watchClock(ctx, node);
        return;
      }
      contextStalled = true;
      hush(node, ctx);
      const why = `the audio context said ${ctx.state} but its clock did not move`;
      if (elementOpen) {
        report('play', 'StalledError', `${why}; playing through the element`);
        return viaElement();
      }
      throw failure('StalledError', why);
    },
    pause: () => {
      stopped = true;
      unwatch();
      if (source) {
        try {
          source.stop();
        } catch {
          /* Already stopped. */
        }
        // A stopped clip no longer holds the output awake.
        if (context) soundingUntil = Math.min(soundingUntil, context.currentTime);
      }
      pauseElement(owner);
    },
  };

  return {
    audio,
    release: () => {
      unwatch();
      source?.disconnect();
      source = null;
      releaseElement(owner);
      if (url) URL.revokeObjectURL(url);
      url = null;
    },
  };
}

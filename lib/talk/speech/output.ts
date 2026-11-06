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
 * Safari only lets sound start from inside a press, so `listenForUnlock`
 * resumes the context on the page's presses while it is not running, and
 * asks the phone to treat this as playback, so the ring/silent switch does
 * not mute it. A browser with no Web Audio, or a clip it cannot decode, falls
 * back to an <audio> element that is played only once it can play through.
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

type AudioContextCtor = new () => AudioContext;

let context: AudioContext | null = null;
/** When, on the context's clock, the last clip stops sounding. */
let soundingUntil = Number.NEGATIVE_INFINITY;

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
 * silent sample, which is what iPhone Safari counts as the page being
 * allowed to play.
 */
export function unlockSpeechOutput(): void {
  askForPlayback();
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

/** Unlocks the sound on the page's presses while it is not running. Installed once. */
export function listenForUnlock(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  const unlock = () => {
    if (context?.state !== 'running') unlockSpeechOutput();
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

/** Plays a bubble's MP3 from its first word. */
export function clipOf(blob: Blob): { audio: SpeechAudio; release: () => void } {
  let source: AudioBufferSourceNode | null = null;
  let element: HTMLAudioElement | null = null;
  let url: string | null = null;
  let stopped = false;

  const throughElement = async () => {
    url = URL.createObjectURL(blob);
    const el = new Audio();
    el.preload = 'auto';
    el.src = url;
    element = el;
    await canPlayThrough(el);
    if (stopped) return;
    el.onended = () => audio.onended?.();
    el.onerror = () => audio.onerror?.();
    await el.play();
  };

  const audio: SpeechAudio = {
    onended: null,
    onerror: null,
    play: async () => {
      const ctx = theContext();
      if (!ctx) return throughElement();
      if (!(await running(ctx))) throw new Error('NotAllowedError');
      let buffer: AudioBuffer;
      try {
        buffer = await decode(ctx, await blob.arrayBuffer());
      } catch {
        return throughElement();
      }
      if (stopped) return;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      node.onended = () => {
        if (!stopped) audio.onended?.();
      };
      const quiet = ctx.currentTime > soundingUntil + QUIET_AFTER_S;
      const at = ctx.currentTime + (quiet ? WAKE_LEAD_S : NEXT_LEAD_S);
      node.start(at);
      soundingUntil = at + buffer.duration;
      source = node;
    },
    pause: () => {
      stopped = true;
      if (source) {
        try {
          source.stop();
        } catch {
          /* Already stopped. */
        }
        // A stopped clip no longer holds the output awake.
        if (context) soundingUntil = Math.min(soundingUntil, context.currentTime);
      }
      element?.pause();
    },
  };

  return {
    audio,
    release: () => {
      source?.disconnect();
      source = null;
      if (url) URL.revokeObjectURL(url);
      url = null;
    },
  };
}

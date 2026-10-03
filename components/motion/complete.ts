/**
 * The completion moment (plan #1552): what happens, beyond the drawing, when
 * the person finishes something. A todo ticked, an item on a task ticked, an
 * agenda item marked done, a goal closed, an item finished in Learn.
 *
 * Every one of those calls `completionMoment()` once the write has come back
 * without an error, so nothing fires on a page load, on a refused write, or on
 * an undo. Capture landing, a swipe's keep or skip and a list being cleared
 * are not completions and do not call it: the list clears because its last
 * item was finished, and that item has already had its moment.
 *
 * The moment plays each effect in COMPLETION_EFFECTS: one short buzz on a
 * phone that can vibrate, and a soft click for whoever has switched it on. An
 * iPhone gives web apps no vibration, so there the buzz does nothing and the
 * motion is the whole moment. Another effect joins by adding an entry to the
 * list; the callers do not change.
 *
 * Both are switched on the account page, and both choices are kept on the
 * device, like the notifications switch beside them, because whether a phone
 * buzzes or makes a sound is a question about that phone. The buzz is on until
 * switched off; the click is off until switched on (docs/UI-QUALITY-SPEC.md,
 * Part 8). Reduced motion silences neither: it is a request about movement,
 * and the click is its own opt-in.
 */

import { CLICK_MS, HAPTIC_MS, MOTION_MS } from '@/lib/motion';

/** Where the buzz switch is kept, in this browser's local storage. */
export const HAPTICS_KEY = 'pt_haptics';

/**
 * Whether this browser can buzz at all. False on an iPhone, on a desktop
 * browser without the Vibration API, and outside a browser.
 */
export function canBuzz(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** Whether the buzz is on for this device. On unless it has been switched off. */
export function hapticsOn(): boolean {
  try {
    return globalThis.localStorage?.getItem(HAPTICS_KEY) !== 'off';
  } catch {
    // Storage blocked (a private window, a locked-down browser): the default.
    return true;
  }
}

/** Switch the buzz on or off for this device. */
export function setHapticsOn(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.removeItem(HAPTICS_KEY);
    else globalThis.localStorage?.setItem(HAPTICS_KEY, 'off');
  } catch {
    // Nowhere to keep it; the switch still shows what was chosen this visit.
  }
}

/**
 * One buzz of HAPTIC_MS, when the device can and the person has not switched
 * it off. Returns whether the browser took it. Never throws: a moment that
 * cannot be felt is still a moment.
 */
export function buzzOnce(): boolean {
  if (!canBuzz() || !hapticsOn()) return false;
  try {
    return navigator.vibrate(HAPTIC_MS);
  } catch {
    return false;
  }
}

/** Where the click switch is kept, in this browser's local storage. */
export const CLICK_KEY = 'pt_click';

/** The click itself: CLICK_MS of soft tick, served from public/. */
export const CLICK_URL = '/sounds/click.wav';

type AudioContextClass = typeof AudioContext;

function audioContextClass(): AudioContextClass | null {
  const g = globalThis as { AudioContext?: AudioContextClass; webkitAudioContext?: AudioContextClass };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** Whether this browser can play the click. False outside a browser. */
export function canClick(): boolean {
  return audioContextClass() !== null;
}

/** Whether the click is on for this device. Off unless it has been switched on. */
export function clickOn(): boolean {
  try {
    return globalThis.localStorage?.getItem(CLICK_KEY) === 'on';
  } catch {
    return false;
  }
}

let audio: AudioContext | null = null;
let clickBuffer: Promise<AudioBuffer | null> | null = null;
let clickReady: AudioBuffer | null = null;

/**
 * Make the click playable: create the audio context, wake it, and fetch and
 * decode the file once. Browsers only let a page start sound after the person
 * has touched it, and a completion's write can come back a few hundred
 * milliseconds after the tap, outside that window. So this runs on the tap
 * itself (armClick), and by the time the write returns the context is awake
 * and the sound is in memory.
 */
export function primeClick(): void {
  const Ctx = audioContextClass();
  if (!Ctx) return;
  try {
    audio ??= new Ctx();
    if (audio.state === 'suspended') void audio.resume().catch(() => {});
    if (!clickBuffer) {
      const ctx = audio;
      clickBuffer = fetch(CLICK_URL)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
        .then((bytes) => ctx.decodeAudioData(bytes))
        .then((buffer) => (clickReady = buffer))
        .catch(() => {
          // Try again on the next tap rather than staying silent for the visit.
          clickBuffer = null;
          return null;
        });
    }
  } catch {
    // No audio for this page; the moment is the motion and the buzz.
  }
}

let armed = false;

/**
 * Listen for the person's taps and keys, and prime the click on each while it
 * is switched on. Cheap when it is off: one storage read per tap. Called when
 * this module loads in a browser, so every page that can complete something
 * has it.
 */
export function armClick(): void {
  if (armed || typeof document === 'undefined') return;
  armed = true;
  const onGesture = () => {
    if (clickOn()) primeClick();
  };
  for (const type of ['pointerdown', 'touchend', 'keydown']) {
    document.addEventListener(type, onGesture, { capture: true, passive: true });
  }
}

/**
 * One click, when it is switched on and the browser can play it. Returns
 * whether it started. Never throws, and never plays late: a click that is not
 * ready when the moment comes is skipped rather than heard after it.
 */
export function clickOnce(): boolean {
  if (!clickOn() || !canClick()) return false;
  try {
    primeClick();
    if (!audio || !clickReady || audio.state !== 'running') return false;
    const source = audio.createBufferSource();
    source.buffer = clickReady;
    source.connect(audio.destination);
    source.start();
    return true;
  } catch {
    return false;
  }
}

/**
 * Switch the click on or off for this device. Switching it on is a tap, so it
 * primes the sound there and then and plays it once, so the person hears what
 * they chose.
 */
export function setClickOn(on: boolean): void {
  try {
    if (on) globalThis.localStorage?.setItem(CLICK_KEY, 'on');
    else globalThis.localStorage?.removeItem(CLICK_KEY);
  } catch {
    // Nowhere to keep it; the switch still shows what was chosen this visit.
  }
  if (!on) return;
  primeClick();
  void Promise.all([audio?.resume(), clickBuffer])
    .then(() => clickOnce())
    .catch(() => {});
}

export interface CompletionEffect {
  /** A short name, for /dev/ui's list of moments. */
  id: string;
  /** What the person gets, in a few words. */
  label: string;
  play: () => void;
}

/** What a completion plays, in order. */
export const COMPLETION_EFFECTS: readonly CompletionEffect[] = [
  { id: 'buzz', label: `one ${HAPTIC_MS}ms buzz, on a phone that can vibrate`, play: buzzOnce },
  { id: 'click', label: `one soft ${CLICK_MS}ms click, once switched on`, play: clickOnce },
];

armClick();

/**
 * Two completions inside one move are one moment: a task ticked with its
 * items, or a double tap that reached two rows, buzzes once.
 */
export const COMPLETION_GAP_MS = MOTION_MS.move;

let lastAt = Number.NEGATIVE_INFINITY;

/** Play the completion moment. Call it after the write has succeeded. */
export function completionMoment(now: number = Date.now()): void {
  if (now - lastAt < COMPLETION_GAP_MS) return;
  lastAt = now;
  for (const effect of COMPLETION_EFFECTS) {
    try {
      effect.play();
    } catch {
      // One effect failing must not take the others, or the write, with it.
    }
  }
}

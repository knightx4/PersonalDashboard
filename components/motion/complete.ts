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
 * The moment plays each effect in COMPLETION_EFFECTS. Today that is one short
 * buzz on a phone that can vibrate. An iPhone gives web apps no vibration, so
 * there the buzz does nothing and the motion is the whole moment. A second
 * effect (the optional completion sound, plan #1553) joins by adding an entry
 * to the list; the callers do not change.
 *
 * The buzz can be switched off on the account page. The choice is kept on the
 * device, like the notifications switch beside it, because whether a phone
 * buzzes is a question about that phone.
 */

import { HAPTIC_MS, MOTION_MS } from '@/lib/motion';

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

export interface CompletionEffect {
  /** A short name, for /dev/ui's list of moments. */
  id: string;
  /** What the person gets, in a few words. */
  label: string;
  play: () => void;
}

/** What a completion plays, in order. */
export const COMPLETION_EFFECTS: readonly CompletionEffect[] = [
  { id: 'buzz', label: 'one 10ms buzz, on a phone that can vibrate', play: buzzOnce },
];

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

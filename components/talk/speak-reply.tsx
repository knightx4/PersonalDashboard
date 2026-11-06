'use client';

import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { Play, Square, Volume2, VolumeX } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { ToggleChip } from '@/components/ui/chip';
import { Tooltip } from '@/components/ui/tooltip';
import { QUIET_PICKER } from '@/components/talk/think-switch';
import { cn } from '@/lib/cn';
import {
  createSpeechPlayer,
  readSpeaking,
  rememberSpeaking,
  SPEAKING_KEY,
  type SpeechAudio,
  type SpeechState,
} from '@/lib/talk/speech/player';

/**
 * Chat replies read aloud (plan #3006.1), on Dash's chat and the mentors'
 * threads.
 *
 * - `SpeakSwitch` turns speaking on or off for this browser. While it is on,
 *   each new reply plays once as it arrives; off, nothing plays by itself.
 * - `SpeakPress` is the play press on a reply, Stop while it loads or plays.
 *   It plays whether or not the switch is on.
 * - `SpeakNote` says under a reply why it was not read aloud (voice not set
 *   up, paused until next month), in the route's words. The reply's text
 *   stays as it was.
 *
 * One player serves the whole page (lib/talk/speech/player.ts), so starting
 * one reply stops another. The gallery draws a state with `SpeechFixture`
 * and plays nothing.
 */

type SpeechFixtureState = { speaking: boolean; state: SpeechState };

/** The gallery's stand-in for the player: drawn in this state, and pressing does nothing. */
export const SpeechFixture = createContext<SpeechFixtureState | null>(null);

/** The fixture as a component, for gallery entries drawn on the server. */
export function SpeechFixtureProvider({ value, children }: { value: SpeechFixtureState; children: React.ReactNode }) {
  return <SpeechFixture.Provider value={value}>{children}</SpeechFixture.Provider>;
}

let player: ReturnType<typeof createSpeechPlayer> | null = null;

function thePlayer() {
  player ??= createSpeechPlayer({
    fetch: (url, init) => fetch(url, init),
    audio: (blob) => {
      const url = URL.createObjectURL(blob);
      const element = new Audio(url);
      const audio: SpeechAudio = { play: () => element.play(), pause: () => element.pause(), onended: null, onerror: null };
      element.onended = () => audio.onended?.();
      element.onerror = () => audio.onerror?.();
      return { audio, release: () => URL.revokeObjectURL(url) };
    },
  });
  return player;
}

const IDLE: SpeechState = { key: null, phase: 'idle', notes: {} };
const speakingListeners = new Set<() => void>();

function subscribeSpeaking(listener: () => void) {
  speakingListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SPEAKING_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    speakingListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function setSpeaking(on: boolean) {
  rememberSpeaking(on);
  if (!on) thePlayer().stop();
  for (const listener of speakingListeners) listener();
}

/** Whether new replies play aloud, as the switch was left in this browser. */
export function useSpeaking(): boolean {
  const fixture = useContext(SpeechFixture);
  const live = useSyncExternalStore(subscribeSpeaking, readSpeaking, () => false);
  return fixture ? fixture.speaking : live;
}

function useSpeech(): SpeechState {
  const fixture = useContext(SpeechFixture);
  const live = useSyncExternalStore(
    (listener) => thePlayer().subscribe(listener),
    () => thePlayer().get(),
    () => IDLE,
  );
  return fixture ? fixture.state : live;
}

/**
 * Plays each of these replies once, in order, while speaking is on: the
 * mentors' thread hands in the messages that arrived while it was open.
 */
export function useSpeakArrivals(replies: readonly { id: string; text: string }[]) {
  const speaking = useSpeaking();
  const fixture = useContext(SpeechFixture);
  useEffect(() => {
    if (!speaking || fixture) return;
    for (const reply of replies) thePlayer().speakOnce(reply.id, reply.text);
  }, [speaking, fixture, replies]);
}

const SWITCH_TIP_ON = 'New replies are read aloud. Press to stop reading them.';
const SWITCH_TIP_OFF = 'Read new replies aloud as they arrive.';

/** Speaking on or off: quiet words under Dash's box, a chip in its foot, or an icon in a thread's header. */
export function SpeakSwitch({ look = 'chip' }: { look?: 'quiet' | 'chip' | 'icon' }) {
  const on = useSpeaking();
  const fixture = useContext(SpeechFixture);
  const toggle = () => {
    if (!fixture) setSpeaking(!on);
  };
  const Icon = on ? Volume2 : VolumeX;
  if (look === 'icon') {
    return (
      <Tooltip label={on ? SWITCH_TIP_ON : SWITCH_TIP_OFF}>
        <IconButton label="Read replies aloud" aria-pressed={on} active={on} onClick={toggle}>
          <Icon strokeWidth={1.75} aria-hidden />
        </IconButton>
      </Tooltip>
    );
  }
  if (look === 'quiet') {
    return (
      <Tooltip label={on ? SWITCH_TIP_ON : SWITCH_TIP_OFF} className="shrink-0">
        <button
          type="button"
          aria-pressed={on}
          onClick={toggle}
          className={cn(QUIET_PICKER, on && 'text-accent hover:text-accent')}
        >
          <Icon strokeWidth={1.75} aria-hidden />
          {on ? 'Speaking' : 'Speak'}
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip label={on ? SWITCH_TIP_ON : SWITCH_TIP_OFF} className="shrink-0">
      <ToggleChip
        on={on}
        aria-label="Read replies aloud"
        onClick={toggle}
        className={on ? 'h-5.5 px-2' : 'h-5.5 w-7 justify-center px-0'}
      >
        <Icon strokeWidth={1.75} aria-hidden />
        {on && <span>Speaking</span>}
      </ToggleChip>
    </Tooltip>
  );
}

/**
 * Play on a reply, and Stop while it loads or plays. `id` keys the reply;
 * `also` names other keys that count as this reply playing (a mentor's
 * messages queued one by one while the press reads them together).
 * `fresh` marks a reply that arrived while the chat was open: it plays once
 * by itself while speaking is on.
 */
export function SpeakPress({
  id,
  text,
  also,
  fresh = false,
}: {
  id: string;
  text: string;
  also?: readonly string[];
  fresh?: boolean;
}) {
  const speech = useSpeech();
  const speaking = useSpeaking();
  const fixture = useContext(SpeechFixture);
  const mine = speech.key !== null && (speech.key === id || (also?.includes(speech.key) ?? false));
  const busy = mine && speech.phase !== 'idle';

  useEffect(() => {
    if (fresh && speaking && !fixture && text.trim()) thePlayer().speakOnce(id, text);
  }, [fresh, speaking, fixture, id, text]);

  if (!text.trim()) return null;
  const label = busy ? (speech.phase === 'loading' ? 'Stop (getting the voice ready)' : 'Stop reading') : 'Read aloud';
  return (
    <Tooltip label={label}>
      <IconButton
        size="sm"
        label={label}
        aria-pressed={busy}
        active={busy}
        onClick={() => {
          if (fixture) return;
          if (busy) thePlayer().stop();
          else thePlayer().play(id, text);
        }}
      >
        {busy ? <Square strokeWidth={1.75} fill="currentColor" aria-hidden /> : <Play strokeWidth={1.75} aria-hidden />}
      </IconButton>
    </Tooltip>
  );
}

/** Why this reply was not read aloud, in the route's own words; nothing when it was. */
export function SpeakNote({ ids, className }: { ids: readonly string[]; className?: string }) {
  const speech = useSpeech();
  const message = ids.map((id) => speech.notes[id]).find(Boolean);
  return (
    <p role="status" aria-live="polite" className={cn('text-small text-ink-muted', !message && 'sr-only', className)}>
      {message ?? ''}
    </p>
  );
}

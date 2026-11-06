'use client';

import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { Play, Square, Volume2, VolumeX } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { QUIET_PICKER } from '@/components/talk/think-switch';
import { cn } from '@/lib/cn';
import { clipOf, listenForUnlock, unlockSpeechOutput } from '@/lib/talk/speech/output';
import {
  createSpeechPlayer,
  readSpeaking,
  rememberSpeaking,
  SPEAKING_KEY,
  type SpeechAudio,
  type SpeechItem,
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
  if (!player) listenForUnlock();
  player ??= createSpeechPlayer({
    fetch: (url, init) => fetch(url, init),
    // Decoded and played through one Web Audio context, so no word is lost off the start (plan #3028).
    audio: clipOf,
    audioUrl: (url) => {
      const element = new Audio(url);
      const audio: SpeechAudio = { play: () => element.play(), pause: () => element.pause(), onended: null, onerror: null };
      element.onended = () => audio.onended?.();
      element.onerror = () => audio.onerror?.();
      return { audio, release: () => element.removeAttribute('src') };
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
  // The switch is a press: the moment to open the sound for the replies that follow.
  if (on) unlockSpeechOutput();
  else thePlayer().stop();
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
 * Plays each of these replies once, in order, while speaking is on: a
 * thread hands in the messages that arrived while it was open, and each is
 * queued, with its audio asked for, as soon as it posts (plan #3028).
 * Leaving the thread, for another or for elsewhere, stops what it queued;
 * `thread` names it.
 */
export function useSpeakArrivals(replies: readonly { id: string; text: string; bot?: string | null }[], thread: string) {
  const speaking = useSpeaking();
  const fixture = useContext(SpeechFixture);
  useEffect(() => {
    if (!speaking || fixture) return;
    for (const reply of replies) thePlayer().speakOnce(reply.id, reply.text, { bot: reply.bot });
  }, [speaking, fixture, replies]);
  useEffect(() => {
    if (fixture) return;
    return () => thePlayer().stop();
  }, [fixture, thread]);
}

/**
 * A voice's sample on a bot's form (plan #3006.5), through the same player,
 * so a sample stops a reply playing and a reply stops a sample. A recording
 * Fish keeps (`url`) is played as it is; without one, `line` is spoken in the
 * voice through /api/speak and counts against the month. Returns whether the
 * sample `key` is loading or playing, and a toggle.
 */
export function useVoiceSample(key: string): { busy: boolean; toggle: (sample: { url: string | null; line: string; voice: string }) => void } {
  const speech = useSpeech();
  const fixture = useContext(SpeechFixture);
  const busy = speech.key === key && speech.phase !== 'idle';
  return {
    busy,
    toggle: (sample) => {
      if (fixture) return;
      if (busy) thePlayer().stop();
      else if (sample.url) thePlayer().playUrl(key, sample.url);
      else thePlayer().play(key, sample.line, { voice: sample.voice });
    },
  };
}

/** Why a sample did not play, in the route's words; null when it did. */
export function useSpeechNote(key: string): string | null {
  return useSpeech().notes[key] ?? null;
}

const SWITCH_TIP_ON = 'New replies are read aloud. Press to stop reading them.';
const SWITCH_TIP_OFF = 'Read new replies aloud as they arrive.';

/**
 * Speaking on or off: quiet words under the box on Chat's Dash tab, or an
 * icon in a header (the Dash sheet's, a mentor thread's), since the sheet's
 * box foot has no room for another press at 390.
 */
export function SpeakSwitch({ look }: { look: 'quiet' | 'icon' }) {
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

/**
 * Play on a reply, and Stop while it loads or plays. `id` keys the reply;
 * `also` names other keys that count as this reply playing (a mentor's
 * messages queued one by one). `parts`, when given, are the bubbles the
 * press reads one after another, each under its own key, so a run already
 * heard as it arrived plays again without being fetched again (plan #3028).
 * `fresh` marks a reply that arrived while the chat was open: it plays once
 * by itself while speaking is on. `bot` is the id of the bot that wrote it,
 * whose own voice it is read in (plan #3006.5); absent, the default voice.
 */
export function SpeakPress({
  id,
  text,
  also,
  parts,
  fresh = false,
  bot = null,
}: {
  id: string;
  text: string;
  also?: readonly string[];
  parts?: readonly { id: string; text: string }[];
  fresh?: boolean;
  bot?: string | null;
}) {
  const speech = useSpeech();
  const speaking = useSpeaking();
  const fixture = useContext(SpeechFixture);
  const mine = speech.key !== null && (speech.key === id || (also?.includes(speech.key) ?? false));
  const busy = mine && speech.phase !== 'idle';

  useEffect(() => {
    if (fresh && speaking && !fixture && text.trim()) thePlayer().speakOnce(id, text, { bot });
  }, [fresh, speaking, fixture, id, text, bot]);

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
          if (busy) {
            thePlayer().stop();
            return;
          }
          unlockSpeechOutput();
          if (parts?.length) thePlayer().playList(parts.map((part): SpeechItem => ({ key: part.id, text: part.text, voice: { bot } })));
          else thePlayer().play(id, text, { bot });
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

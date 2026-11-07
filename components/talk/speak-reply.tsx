'use client';

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Play, Square, Volume, Volume2, VolumeX } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { QUIET_PICKER } from '@/components/talk/think-switch';
import { cn } from '@/lib/cn';
import { clipOf, linkClip, listenForUnlock, unlockSpeechOutput } from '@/lib/talk/speech/output';
import {
  bubbleVoice,
  createSpeechPlayer,
  readSpeaking,
  rememberSpeaking,
  SPEAK_HELD_BACK,
  SPEAKING_KEY,
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
 * one reply stops another. A chat's send press calls `unlockSpeechOutput`
 * (lib/talk/speech/output.ts) in its own handler, so iPhone Safari lets the
 * replies that arrive afterwards play (plan #3036). The gallery draws a state with `SpeechFixture`
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
    // Through the page's one <audio> element, which a press opened for iPhone Safari (plan #3036).
    audioUrl: linkClip,
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
  // Listening from the moment the thread opens, so the first press opens the sound (plan #3036).
  useEffect(() => {
    if (!fixture) listenForUnlock();
  }, [fixture]);
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
  name = 'Dash',
}: {
  id: string;
  text: string;
  also?: readonly string[];
  parts?: readonly { id: string; text: string }[];
  fresh?: boolean;
  bot?: string | null;
  /** Who wrote it, for the speaking pill: Dash unless a bot's name is given. */
  name?: string;
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
  // One reply on its own (an answer of Dash's) shows the bubble's speaker while speaking is on (plan #3043).
  if (speaking && !parts) return <SpeakBubble id={id} text={text} name={name} bot={bot} />;
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

/**
 * Three bars that rise and fall while a reply is read aloud (plan #3043),
 * standing still at rest and under reduced motion (app/globals.css).
 */
function SpeakBars({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <span aria-hidden data-playing={playing || undefined} className={cn('speak-bars inline-flex h-3 items-end gap-px', className)}>
      <span className="h-1/2 w-0.5 rounded-pill bg-current" />
      <span className="h-full w-0.5 rounded-pill bg-current" />
      <span className="h-3/4 w-0.5 rounded-pill bg-current" />
    </span>
  );
}

const BUBBLE_LABEL = {
  playing: 'Stop reading',
  loading: 'Stop (getting the voice ready)',
  blocked: 'Your browser held the sound back. Press to play this reply',
  rest: 'Play this reply again',
} as const;

/**
 * The speaker on a bot's bubble while speaking is on (plan #3043). Its bars
 * move while the bubble is read aloud, and a press stops it; at rest a press
 * reads the bubble again, and the rest of its run after it (`then`), through
 * the one player, stopping whatever was playing. A bubble the browser would
 * not play by itself turns grey with a play arrow, and a press, which the
 * browser does allow, plays it. Nothing is drawn while speaking is off, where
 * the run's Read aloud press stands instead. `name` is who is speaking, for
 * the speaking pill at the top of the thread, which finds the bubble by its
 * `data-speech-key`.
 */
export function SpeakBubble({
  id,
  text,
  name,
  bot = null,
  then = [],
}: {
  id: string;
  text: string;
  name: string;
  bot?: string | null;
  then?: readonly { id: string; text: string }[];
}) {
  const speech = useSpeech();
  const speaking = useSpeaking();
  const fixture = useContext(SpeechFixture);
  if (!speaking || !text.trim()) return null;
  const voice = bubbleVoice(speech, id);
  const busy = voice === 'playing' || voice === 'loading';
  const label = BUBBLE_LABEL[voice];
  return (
    <Tooltip label={label}>
      <IconButton
        size="sm"
        label={label}
        aria-pressed={busy}
        active={busy}
        data-speech-key={id}
        data-speech-name={name}
        className={cn('w-auto gap-0.5 px-1', voice === 'blocked' && 'bg-sunken text-ink-muted')}
        onClick={() => {
          if (fixture) return;
          if (busy) {
            thePlayer().stop();
            return;
          }
          unlockSpeechOutput();
          const items = [{ id, text }, ...then].map((part): SpeechItem => ({ key: part.id, text: part.text, voice: { bot } }));
          thePlayer().playList(items);
        }}
      >
        <Volume strokeWidth={1.75} aria-hidden />
        {voice === 'blocked' ? (
          <Play strokeWidth={1.75} fill="currentColor" aria-hidden className="size-2.5!" />
        ) : (
          <SpeakBars playing={voice === 'playing'} />
        )}
      </IconButton>
    </Tooltip>
  );
}

/**
 * The speaking pill (plan #3043): pinned at the top of a thread while one of
 * its bubbles is read aloud, saying who is speaking, with the bars and a
 * Stop that ends the reply and empties the queue. It stays up across a run
 * of queued bubbles, since the player moves from one to the next without
 * going idle, and a press on its words scrolls to the bubble being read.
 *
 * It is drawn as the first thing in the thread's scrolling part and finds
 * the bubble among its siblings by `data-speech-key`, so a pill shows only
 * in the thread whose bubble is playing: the Ask Dash pane's chat and a
 * person's thread each have their own. It takes no room in the thread.
 */
export function SpeakingPill({ className }: { className?: string }) {
  const speech = useSpeech();
  const speaking = useSpeaking();
  const fixture = useContext(SpeechFixture);
  const anchor = useRef<HTMLDivElement>(null);
  const [found, setFound] = useState<{ key: string; name: string } | null>(null);
  const key = speaking && speech.phase !== 'idle' ? speech.key : null;

  // Read after the bubbles are drawn, since the pill sits above them.
  useEffect(() => {
    const scope = anchor.current?.parentElement;
    const bubble = key && scope ? scope.querySelector<HTMLElement>(`[data-speech-key="${CSS.escape(key)}"]`) : null;
    setFound(bubble && key ? { key, name: bubble.dataset.speechName ?? '' } : null);
  }, [key]);

  const shown = found && found.key === key ? found : null;
  const goTo = () => {
    if (!shown) return;
    const bubble = anchor.current?.parentElement?.querySelector<HTMLElement>(`[data-speech-key="${CSS.escape(shown.key)}"]`);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    bubble?.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  };

  return (
    <div ref={anchor} className={cn('pointer-events-none sticky top-0 z-over-link h-0 self-stretch', className)}>
      {shown && (
        <div className="flex justify-center">
          <div
            role="status"
            className="popover-panel pointer-events-auto flex max-w-full items-center rounded-pill border border-border bg-raised py-0.5 pr-0.5 pl-1" /* ui-ok: a floating pill over the thread, framed as the menus are so it reads above the bubbles */
          >
            <button
              type="button"
              onClick={goTo}
              className="press press-area flex min-w-0 items-center gap-1.5 rounded-pill px-2 py-0.5 text-small text-ink hover:bg-sunken" /* ui-ok: the speaking pill's own words, a press that scrolls to the bubble being read, inside the pill */
            >
              <SpeakBars playing={speech.phase === 'playing'} className="shrink-0 text-accent" />
              <span className="truncate">
                <span className="font-medium">{shown.name}</span> speaking
              </span>
            </button>
            <Tooltip label="Stop speaking">
              <IconButton
                size="sm"
                label="Stop speaking"
                onClick={() => {
                  if (!fixture) thePlayer().stop();
                }}
              >
                <Square strokeWidth={1.75} fill="currentColor" aria-hidden />
              </IconButton>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
}

/** Why this reply was not read aloud, in the route's own words; nothing when it was. */
export function SpeakNote({ ids, className }: { ids: readonly string[]; className?: string }) {
  const speech = useSpeech();
  const speaking = useSpeaking();
  // While speaking is on, a reply held back says so on its own bubble's speaker (plan #3043).
  const message = ids.map((id) => speech.notes[id]).find((note) => Boolean(note) && !(speaking && note === SPEAK_HELD_BACK));
  return (
    <p role="status" aria-live="polite" className={cn('text-small text-ink-muted', !message && 'sr-only', className)}>
      {message ?? ''}
    </p>
  );
}

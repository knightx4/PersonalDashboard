/**
 * Playing chat replies aloud in the browser (plan #3006.1): one reply at a
 * time, across Dash's chat and the mentors' threads.
 *
 * The chat hands in a reply's key and its text. The player posts the text to
 * /api/speak (plan #3006.3) and plays the MP3 that comes back. When the route
 * says no (`{ why, message }`: voice not set up, paused until next month, out
 * of credit, failed), the message is kept under the reply's key, as the route
 * wrote it, for the chat to show under that reply; the reply's text is never
 * touched.
 *
 * - `play` starts a reply now, stopping whatever was playing.
 * - `queue` plays it after what is playing: a mentor sends a reply as several
 *   messages, and each arriving one is queued so they read in order.
 * - `speakOnce` queues a reply the first time it is asked for and never
 *   again, so a new reply plays once however often its row is drawn.
 * - `stop` ends the reply playing and empties the queue.
 *
 * Whether new replies play at all is the speaking switch, kept in this
 * browser's storage (`talk.speaking`, '1' while on). Every access is
 * guarded: where site data is blocked the switch lasts until the page is
 * left.
 *
 * The fetch and the audio element are handed in so the order can be tested
 * (player.test.ts).
 */

export type SpeechPhase = 'idle' | 'loading' | 'playing';

export type SpeechState = {
  /** The reply loading or playing; null while idle. */
  key: string | null;
  phase: SpeechPhase;
  /** Why a reply was not read aloud, by its key, as the route wrote it. */
  notes: Readonly<Record<string, string>>;
};

/** The part of an audio element the player uses. */
export type SpeechAudio = {
  play: () => Promise<void>;
  pause: () => void;
  onended: (() => void) | null;
  onerror: (() => void) | null;
};

export type PlayerDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** An audio element playing the MP3 in this blob. */
  audio: (blob: Blob) => { audio: SpeechAudio; release: () => void };
  /** An audio element playing the recording at this link (plan #3006.5). */
  audioUrl?: (url: string) => { audio: SpeechAudio; release: () => void };
};

/** A stand-in that cannot play, for a player given no audioUrl. */
function silent(): SpeechAudio {
  return { play: () => Promise.reject(new Error('no audio for links')), pause: () => {}, onended: null, onerror: null };
}

/** What the chat shows when the route could not be reached or answered with nothing it could read. */
export const SPEAK_UNREACHABLE = 'This reply could not be read aloud. Check your connection and press play again.';
/** A browser that blocks sound until the page is pressed holds back the first reply. */
export const SPEAK_HELD_BACK = 'Your browser held the sound back. Press play to hear this reply.';

export const SPEAKING_KEY = 'talk.speaking';

/**
 * Whose voice a reply is read in (plan #3006.5): `bot`, the id of the bot
 * that wrote it, read in its own voice when it has one; or `voice`, a Fish
 * voice id, for a sample on a bot's form. Neither reads it in the default.
 */
export type SpeechVoice = { bot?: string | null; voice?: string | null };

function voiceFields(voice: SpeechVoice | undefined): { bot?: string; voice?: string } {
  if (voice?.voice) return { voice: voice.voice };
  if (voice?.bot) return { bot: voice.bot };
  return {};
}

const IDLE: SpeechState = { key: null, phase: 'idle', notes: {} };

export function createSpeechPlayer(deps: PlayerDeps) {
  let state: SpeechState = IDLE;
  const listeners = new Set<() => void>();
  const spoken = new Set<string>();
  let waiting: { key: string; text: string; voice?: SpeechVoice }[] = [];
  type Current = { abort: AbortController; audio: SpeechAudio | null; release: () => void };
  let current: Current | null = null;

  const set = (next: Partial<SpeechState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  const note = (key: string, message: string | null): Readonly<Record<string, string>> => {
    const notes = { ...state.notes };
    if (message === null) delete notes[key];
    else notes[key] = message;
    return notes;
  };

  const end = () => {
    if (!current) return;
    current.abort.abort();
    current.audio?.pause();
    current.release();
    current = null;
  };

  const next = () => {
    const item = waiting.shift();
    if (item) void start(item.key, item.text, item.voice);
    else set({ key: null, phase: 'idle' });
  };

  async function start(key: string, text: string, voice?: SpeechVoice) {
    end();
    const mine = { abort: new AbortController(), audio: null as SpeechAudio | null, release: () => {} };
    current = mine;
    set({ key, phase: 'loading', notes: note(key, null) });

    let response: Response;
    try {
      response = await deps.fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, ...voiceFields(voice) }),
        signal: mine.abort.signal,
      });
    } catch {
      if (current !== mine) return;
      current = null;
      set({ notes: note(key, SPEAK_UNREACHABLE) });
      next();
      return;
    }
    if (current !== mine) return;

    if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) {
      const message = await response
        .json()
        .then((body: unknown) =>
          body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
            ? (body as { message: string }).message
            : SPEAK_UNREACHABLE,
        )
        .catch(() => SPEAK_UNREACHABLE);
      if (current !== mine) return;
      current = null;
      set({ notes: note(key, message) });
      next();
      return;
    }

    let blob: Blob;
    try {
      blob = await response.blob();
    } catch {
      if (current !== mine) return;
      current = null;
      set({ notes: note(key, SPEAK_UNREACHABLE) });
      next();
      return;
    }
    if (current !== mine) return;
    await sound(mine, key, deps.audio(blob));
  }

  /** Plays what was made for `key`, then moves on to what waits. */
  async function sound(mine: Current, key: string, made: { audio: SpeechAudio; release: () => void }) {
    mine.audio = made.audio;
    mine.release = made.release;
    const finished = () => {
      if (current !== mine) return;
      made.release();
      current = null;
      next();
    };
    made.audio.onended = finished;
    made.audio.onerror = () => {
      if (current !== mine) return;
      set({ notes: note(key, SPEAK_UNREACHABLE) });
      finished();
    };
    try {
      await made.audio.play();
      if (current === mine) set({ phase: 'playing' });
    } catch {
      if (current !== mine) return;
      made.release();
      current = null;
      set({ notes: note(key, SPEAK_HELD_BACK) });
      next();
    }
  }

  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Plays this reply now, stopping what was playing and emptying the queue. */
    play(key: string, text: string, voice?: SpeechVoice) {
      spoken.add(key);
      waiting = [];
      void start(key, text, voice);
    },
    /** Plays this reply after what is playing or waiting. */
    queue(key: string, text: string, voice?: SpeechVoice) {
      spoken.add(key);
      if (state.phase === 'idle' && !current) void start(key, text, voice);
      else waiting.push({ key, text, voice });
    },
    /**
     * Plays a recording at a link now (a voice's sample, plan #3006.5),
     * stopping what was playing and emptying the queue. Nothing is spent.
     */
    playUrl(key: string, url: string) {
      waiting = [];
      end();
      const mine: Current = { abort: new AbortController(), audio: null, release: () => {} };
      current = mine;
      set({ key, phase: 'loading', notes: note(key, null) });
      void sound(mine, key, deps.audioUrl ? deps.audioUrl(url) : { audio: silent(), release: () => {} });
    },
    /** Queues a reply the first time only: a new reply plays once. */
    speakOnce(key: string, text: string, voice?: SpeechVoice) {
      if (spoken.has(key)) return;
      this.queue(key, text, voice);
    },
    stop() {
      waiting = [];
      end();
      set({ key: null, phase: 'idle' });
    },
  };
}

export type SpeechPlayer = ReturnType<typeof createSpeechPlayer>;

/** Whether new replies play aloud in this browser; off until switched on. */
export function readSpeaking(): boolean {
  try {
    return window.localStorage.getItem(SPEAKING_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberSpeaking(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(SPEAKING_KEY, '1');
    else window.localStorage.removeItem(SPEAKING_KEY);
  } catch {
    /* Storage blocked: the switch lasts until the page is left. */
  }
}

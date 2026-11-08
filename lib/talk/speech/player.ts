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
 * - `playList` does the same for a run of bubbles, read one after another.
 * - `queue` plays it after what is playing: a bot sends a reply as several
 *   bubbles, and each arriving one joins the end of the queue, so they are
 *   read in the order they posted and a new one never cuts into the one
 *   speaking.
 * - `speakOnce` queues a reply the first time it is asked for and never
 *   again, so a new reply plays once however often its row is drawn.
 * - `stop` ends the reply playing and empties the queue.
 *
 * Each bubble's audio is asked for the moment it is queued (plan #3028), not
 * when its turn comes, so the second and third are fetched while the first
 * speaks and are ready when it ends. Playback still follows the queue's
 * order: a clip still loading when its turn comes is waited for, and one the
 * route refused is skipped with its note while the rest carry on. Between
 * bubbles there is a short pause, BUBBLE_GAP_MS, like someone moving on to
 * their next text.
 *
 * What came back is kept by the bubble's key, text and voice, so a bubble is
 * never sent twice: a press on a run already heard, or on a bubble that was
 * stopped while its audio was on its way, plays what came back without
 * spending the month's characters again. A stop lets fetches already sent
 * finish into that store instead of throwing away audio already paid for.
 *
 * Whether new replies play at all is the speaking switch, kept in this
 * browser's storage (`talk.speaking`, '1' while on). Every access is
 * guarded: where site data is blocked the switch lasts until the page is
 * left.
 *
 * A reply is `playing` only once its audio says it sounds (plan #3068): the
 * audio's `play` resolves when its clock has moved, and rejects when the
 * browser held the sound back or ran it in silence, which shows the play
 * press. Every reason a reply did not sound (the route's status and why, a
 * body that was empty or not audio, the name of the error `play` threw, a
 * stop part way) is handed to `report`, for the log a silent phone leaves.
 *
 * The fetch, the audio and the wait are handed in so the order can be tested
 * (player.test.ts); the browser's side is lib/talk/speech/output.ts.
 */

export type SpeechPhase = 'idle' | 'loading' | 'playing';

export type SpeechState = {
  /** The reply loading or playing; null while idle. */
  key: string | null;
  phase: SpeechPhase;
  /** Why a reply was not read aloud, by its key, as the route wrote it. */
  notes: Readonly<Record<string, string>>;
  /** Whether a bubble of this run has sounded, so the speaking pill stays up between bubbles. */
  heard?: boolean;
};

/** The part of an audio element the player uses. */
export type SpeechAudio = {
  play: () => Promise<void>;
  pause: () => void;
  onended: (() => void) | null;
  /** `held` when the sound stopped part way and a press would bring it back. */
  onerror: ((held?: boolean) => void) | null;
};

/** Why a reply did not sound, for the log (plan #3068). */
export type SpeechFailure = {
  stage: 'fetch' | 'play' | 'playback';
  key: string;
  /** The route's status, for a fetch it answered. */
  status?: number;
  /** The route's `why`, or what was wrong with what came back. */
  why?: string;
  /** The error's name: NotAllowedError, StalledError, AbortError, TypeError. */
  name?: string;
  message?: string;
};

export type PlayerDeps = {
  /** Asked for each bubble's audio; never aborted, so what is paid for is kept. */
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Something that plays the MP3 in this blob. */
  audio: (blob: Blob) => { audio: SpeechAudio; release: () => void };
  /** An audio element playing the recording at this link (plan #3006.5). */
  audioUrl?: (url: string) => { audio: SpeechAudio; release: () => void };
  /** The pause between bubbles: a timer unless a test hands in its own. */
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Told each reason a reply did not sound. */
  report?: (failure: SpeechFailure) => void;
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

/** The pause between one bubble ending and the next starting. */
export const BUBBLE_GAP_MS = 300;

/** How many bubbles' audio is kept for a second hearing. */
const KEPT_CLIPS = 40;

/**
 * Whose voice a reply is read in (plan #3006.5): `bot`, the id of the bot
 * that wrote it, read in its own voice when it has one; or `voice`, a Fish
 * voice id, for a sample on a bot's form. Neither reads it in the default.
 */
export type SpeechVoice = { bot?: string | null; voice?: string | null };

/** One bubble to read, as a run's press hands them in. */
export type SpeechItem = { key: string; text: string; voice?: SpeechVoice };

function voiceFields(voice: SpeechVoice | undefined): { bot?: string; voice?: string } {
  if (voice?.voice) return { voice: voice.voice };
  if (voice?.bot) return { bot: voice.bot };
  return {};
}

/** What came back for a bubble: its audio, or the route's word on why not. */
type Clip = { ok: true; blob: Blob } | { ok: false; message: string };

type Queued = { key: string; clip: Promise<Clip> };

const IDLE: SpeechState = { key: null, phase: 'idle', notes: {}, heard: false };

export function createSpeechPlayer(deps: PlayerDeps) {
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => Date.now());
  const report = (failure: SpeechFailure) => {
    try {
      deps.report?.(failure);
    } catch {
      /* The log never stops the sound. */
    }
  };
  let state: SpeechState = IDLE;
  const listeners = new Set<() => void>();
  const spoken = new Set<string>();
  const fetched = new Map<string, Promise<Clip>>();
  let waiting: Queued[] = [];
  /** Bumped by every stop and every fresh start, so a turn begun before it does nothing. */
  let run = 0;
  type Made = { audio: SpeechAudio; release: () => void };
  let current: Made | null = null;
  /** When the last bubble finished, for the pause before the next. */
  let endedAt: number | null = null;

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
    current.audio.pause();
    current.release();
    current = null;
  };

  /** Asks the route for a bubble's audio once. A refusal is not kept, so a press can ask again. */
  function clipFor(item: SpeechItem): Promise<Clip> {
    const fields = voiceFields(item.voice);
    const id = JSON.stringify([item.key, item.text, fields.voice ?? null, fields.bot ?? null]);
    const kept = fetched.get(id);
    if (kept) return kept;
    const clip = ask(item.key, item.text, fields);
    fetched.set(id, clip);
    void clip.then((made) => {
      if (!made.ok && fetched.get(id) === clip) fetched.delete(id);
    });
    while (fetched.size > KEPT_CLIPS) fetched.delete(fetched.keys().next().value as string);
    return clip;
  }

  async function ask(key: string, text: string, fields: { bot?: string; voice?: string }): Promise<Clip> {
    let response: Response;
    try {
      response = await deps.fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, ...fields }),
      });
    } catch (error) {
      report({ stage: 'fetch', key, why: 'unreachable', ...named(error) });
      return { ok: false, message: SPEAK_UNREACHABLE };
    }
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.startsWith('audio/')) {
      const body: unknown = await response.json().catch(() => null);
      const said = body && typeof body === 'object' ? (body as { message?: unknown; why?: unknown }) : {};
      report({ stage: 'fetch', key, status: response.status, why: typeof said.why === 'string' ? said.why : `not audio (${type || 'no type'})` });
      return { ok: false, message: typeof said.message === 'string' ? said.message : SPEAK_UNREACHABLE };
    }
    let blob: Blob;
    try {
      blob = await response.blob();
    } catch (error) {
      report({ stage: 'fetch', key, status: response.status, why: 'body unread', ...named(error) });
      return { ok: false, message: SPEAK_UNREACHABLE };
    }
    if (blob.size === 0) {
      report({ stage: 'fetch', key, status: response.status, why: 'empty body' });
      return { ok: false, message: SPEAK_UNREACHABLE };
    }
    return { ok: true, blob };
  }

  const enqueue = (item: SpeechItem): Queued => ({ key: item.key, clip: clipFor(item) });

  /** Plays the next bubble waiting, or goes idle when none is. */
  async function turn(mine: number) {
    const item = waiting.shift();
    if (!item) {
      endedAt = null;
      set({ key: null, phase: 'idle', heard: false });
      return;
    }
    set({ key: item.key, phase: 'loading', notes: note(item.key, null) });
    const clip = await item.clip;
    if (mine !== run) return;
    if (!clip.ok) {
      set({ notes: note(item.key, clip.message) });
      void turn(mine);
      return;
    }
    if (endedAt !== null) {
      const rest = BUBBLE_GAP_MS - (now() - endedAt);
      if (rest > 0) await wait(rest);
      if (mine !== run) return;
    }
    await sound(mine, item.key, deps.audio(clip.blob));
  }

  /** Plays what was made for `key`, then moves on to what waits. */
  async function sound(mine: number, key: string, made: Made) {
    current = made;
    const finished = () => {
      if (mine !== run || current !== made) return;
      made.release();
      current = null;
      endedAt = now();
      void turn(mine);
    };
    made.audio.onended = finished;
    made.audio.onerror = (held) => {
      if (mine !== run || current !== made) return;
      report({ stage: 'playback', key, name: held ? 'Interrupted' : 'MediaError' });
      set({ notes: note(key, held ? SPEAK_HELD_BACK : SPEAK_UNREACHABLE) });
      finished();
    };
    try {
      await made.audio.play();
      if (mine === run && current === made) set({ phase: 'playing', heard: true });
    } catch (error) {
      if (mine !== run || current !== made) return;
      report({ stage: 'play', key, ...named(error) });
      made.release();
      current = null;
      set({ notes: note(key, SPEAK_HELD_BACK) });
      void turn(mine);
    }
  }

  /** Stops everything and reads these bubbles from the top. */
  function fresh(items: readonly SpeechItem[]) {
    run += 1;
    end();
    endedAt = null;
    for (const item of items) spoken.add(item.key);
    set({ heard: false });
    waiting = items.map(enqueue);
    void turn(run);
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
      fresh([{ key, text, voice }]);
    },
    /** Plays these bubbles now, one after another, stopping what was playing. */
    playList(items: readonly SpeechItem[]) {
      if (items.length > 0) fresh(items);
    },
    /** Plays this reply after what is playing or waiting, and asks for its audio now. */
    queue(key: string, text: string, voice?: SpeechVoice) {
      spoken.add(key);
      waiting.push(enqueue({ key, text, voice }));
      if (state.phase === 'idle' && !current) void turn(run);
    },
    /**
     * Plays a recording at a link now (a voice's sample, plan #3006.5),
     * stopping what was playing and emptying the queue. Nothing is spent.
     */
    playUrl(key: string, url: string) {
      run += 1;
      waiting = [];
      end();
      endedAt = null;
      set({ key, phase: 'loading', notes: note(key, null), heard: false });
      void sound(run, key, deps.audioUrl ? deps.audioUrl(url) : { audio: silent(), release: () => {} });
    },
    /** Queues a reply the first time only: a new reply plays once. */
    speakOnce(key: string, text: string, voice?: SpeechVoice) {
      if (spoken.has(key)) return;
      this.queue(key, text, voice);
    },
    stop() {
      run += 1;
      waiting = [];
      end();
      endedAt = null;
      set({ key: null, phase: 'idle', heard: false });
    },
  };
}

export type SpeechPlayer = ReturnType<typeof createSpeechPlayer>;

function named(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: typeof error, message: String(error) };
}

/**
 * Whether the speaking pill is up (plan #3068): while a bubble sounds, and
 * between the bubbles of a run once one has sounded. Never while the first
 * is still on its way, nor for a run the browser held back.
 */
export function pillShows(state: SpeechState): boolean {
  return state.phase === 'playing' || (state.phase === 'loading' && state.heard === true);
}

/**
 * How a bubble's speaker icon is drawn (plan #3043): `playing` while its
 * audio sounds, `loading` while its turn has come and the audio is on its
 * way, `blocked` when the browser held the sound back (a press plays it),
 * and `rest` otherwise, ready to play it again.
 */
export type BubbleVoice = 'playing' | 'loading' | 'blocked' | 'rest';

export function bubbleVoice(state: SpeechState, key: string): BubbleVoice {
  if (state.key === key && state.phase !== 'idle') return state.phase;
  return state.notes[key] === SPEAK_HELD_BACK ? 'blocked' : 'rest';
}

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

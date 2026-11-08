import { describe, expect, it, vi } from 'vitest';
import {
  BUBBLE_GAP_MS,
  bubbleVoice,
  createSpeechPlayer,
  pillShows,
  SPEAK_HELD_BACK,
  SPEAK_UNREACHABLE,
  type SpeechAudio,
  type SpeechFailure,
} from './player';

function audioResponse() {
  return new Response(new Blob(['mp3'], { type: 'audio/mpeg' }), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
}

function refusal(status: number, why: string, message: string) {
  return new Response(JSON.stringify({ why, message }), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(responses: (() => Promise<Response>)[], play: () => Promise<void> = async () => {}) {
  const sent: string[] = [];
  const audios: SpeechAudio[] = [];
  const released: number[] = [];
  const waits: number[] = [];
  const player = createSpeechPlayer({
    wait: async (ms) => {
      waits.push(ms);
    },
    now: () => 1000,
    fetch: (_url, init) => {
      sent.push(JSON.parse(String(init.body)).text);
      const next = responses.shift();
      return next ? next() : Promise.resolve(audioResponse());
    },
    audio: () => {
      const audio: SpeechAudio = { play: vi.fn(play), pause: vi.fn(), onended: null, onerror: null };
      audios.push(audio);
      return { audio, release: () => released.push(audios.length) };
    },
  });
  return { player, sent, audios, released, waits };
}

/** A response that arrives when the test says. */
function later() {
  let answer: (r: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => (answer = resolve));
  return { next: () => promise, answer: () => answer(audioResponse()) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the speech player', () => {
  it('plays a reply and goes idle when it ends', async () => {
    const { player, sent, audios, released } = setup([]);
    player.play('a', 'Hello there.');
    expect(player.get()).toMatchObject({ key: 'a', phase: 'loading' });
    await settle();
    expect(sent).toEqual(['Hello there.']);
    expect(player.get()).toMatchObject({ key: 'a', phase: 'playing' });
    audios[0].onended?.();
    expect(player.get()).toMatchObject({ key: null, phase: 'idle' });
    expect(released).toEqual([1]);
  });

  it('names the bot that wrote a queued reply, or the voice of a sample, to the route', async () => {
    const bodies: Record<string, unknown>[] = [];
    const player = createSpeechPlayer({
      fetch: (_url, init) => {
        bodies.push(JSON.parse(String(init.body)));
        return Promise.resolve(audioResponse());
      },
      audio: () => ({ audio: { play: async () => {}, pause: () => {}, onended: null, onerror: null }, release: () => {} }),
    });
    player.queue('a', 'From Zena.', { bot: 'zena-id' });
    player.queue('b', 'From Jerwyn.', { bot: 'jerwyn-id' });
    await settle();
    player.stop();
    player.play('c', 'A sample.', { voice: 'v1', bot: 'ignored' });
    player.play('d', 'Dash.');
    await settle();
    expect(bodies).toEqual([
      { text: 'From Zena.', bot: 'zena-id' },
      { text: 'From Jerwyn.', bot: 'jerwyn-id' },
      { text: 'A sample.', voice: 'v1' },
      { text: 'Dash.' },
    ]);
  });

  it("keeps the route's message under the reply when voice is paused or not set up", async () => {
    const paused = "Voice is paused until next month: this month's 330,000 characters have been spoken.";
    const { player } = setup([
      async () => refusal(429, 'paused', paused),
      async () => refusal(503, 'not-set', 'Voice is not set up yet.'),
    ]);
    player.play('a', 'One.');
    await settle();
    expect(player.get()).toMatchObject({ key: null, phase: 'idle', notes: { a: paused } });
    player.play('b', 'Two.');
    await settle();
    expect(player.get().notes).toEqual({ a: paused, b: 'Voice is not set up yet.' });
  });

  it('says it could not be reached when the fetch fails', async () => {
    const { player } = setup([() => Promise.reject(new Error('offline'))]);
    player.play('a', 'One.');
    await settle();
    expect(player.get().notes.a).toBe(SPEAK_UNREACHABLE);
  });

  it('says the browser held the sound back when play is refused', async () => {
    const { player } = setup([], () => Promise.reject(new Error('NotAllowedError')));
    player.play('a', 'One.');
    await settle();
    expect(player.get()).toMatchObject({ phase: 'idle', notes: { a: SPEAK_HELD_BACK } });
  });

  it('plays queued replies in order, and a new reply only once', async () => {
    const { player, sent, audios } = setup([]);
    player.speakOnce('a', 'First.');
    player.speakOnce('b', 'Second.');
    player.speakOnce('a', 'First.');
    await settle();
    expect(sent).toEqual(['First.', 'Second.']);
    expect(audios).toHaveLength(1);
    audios[0].onended?.();
    await settle();
    expect(audios).toHaveLength(2);
    expect(player.get()).toMatchObject({ key: 'b', phase: 'playing' });
    audios[1].onended?.();
    player.speakOnce('b', 'Second.');
    await settle();
    expect(sent).toHaveLength(2);
  });

  it('stops what is playing and empties the queue', async () => {
    const { player, audios } = setup([]);
    player.queue('a', 'First.');
    player.queue('b', 'Second.');
    await settle();
    player.stop();
    expect(audios[0].pause).toHaveBeenCalled();
    expect(player.get()).toMatchObject({ key: null, phase: 'idle' });
    audios[0].onended?.();
    await settle();
    expect(audios).toHaveLength(1);
    expect(player.get()).toMatchObject({ key: null, phase: 'idle' });
  });

  it('a press on another reply stops the first, and a late answer for the first is dropped', async () => {
    let answerFirst: (r: Response) => void = () => {};
    const { player, audios } = setup([() => new Promise((resolve) => (answerFirst = resolve))]);
    player.play('a', 'First.');
    player.play('b', 'Second.');
    await settle();
    answerFirst(audioResponse());
    await settle();
    expect(audios).toHaveLength(1);
    expect(player.get()).toMatchObject({ key: 'b', phase: 'playing' });
  });

  it('asks for every bubble as it is queued, while the first speaks (plan #3028)', async () => {
    const second = later();
    const third = later();
    const { player, sent, audios } = setup([async () => audioResponse(), second.next, third.next]);
    player.queue('a', 'One.');
    await settle();
    expect(player.get()).toMatchObject({ key: 'a', phase: 'playing' });
    player.queue('b', 'Two.');
    player.queue('c', 'Three.');
    // Both are on their way before the first ends, and neither cuts into it.
    expect(sent).toEqual(['One.', 'Two.', 'Three.']);
    expect(audios).toHaveLength(1);
    expect(audios[0].pause).not.toHaveBeenCalled();
  });

  it('plays in the order the bubbles posted, not the order their audio came back, waiting for a slow one', async () => {
    const first = later();
    const { player, audios } = setup([first.next, async () => audioResponse(), async () => audioResponse()]);
    player.queue('a', 'One.');
    player.queue('b', 'Two.');
    player.queue('c', 'Three.');
    await settle();
    // Two and three are back, one is not: nothing plays yet, and two does not jump ahead.
    expect(audios).toHaveLength(0);
    expect(player.get()).toMatchObject({ key: 'a', phase: 'loading' });
    first.answer();
    await settle();
    expect(player.get()).toMatchObject({ key: 'a', phase: 'playing' });
    audios[0].onended?.();
    await settle();
    expect(player.get()).toMatchObject({ key: 'b', phase: 'playing' });
    audios[1].onended?.();
    await settle();
    expect(player.get()).toMatchObject({ key: 'c', phase: 'playing' });
    audios[2].onended?.();
    await settle();
    expect(player.get()).toMatchObject({ key: null, phase: 'idle' });
  });

  it('reads eight bots answering in a row one after another, each in its own voice, fetching all at once (plan #3080)', async () => {
    const bodies: { text: string; bot?: string }[] = [];
    const audios: SpeechAudio[] = [];
    const player = createSpeechPlayer({
      wait: async () => {},
      fetch: (_url, init) => {
        bodies.push(JSON.parse(String(init.body)));
        return Promise.resolve(audioResponse());
      },
      audio: () => {
        const audio: SpeechAudio = { play: vi.fn(async () => {}), pause: vi.fn(), onended: null, onerror: null };
        audios.push(audio);
        return { audio, release: () => {} };
      },
    });
    const bots = ['ada', 'ben', 'cy', 'dee', 'eve', 'fay', 'gus', 'hal'];
    for (const bot of bots) player.speakOnce(`m-${bot}`, `${bot} says one thing.`, { bot });
    await settle();
    expect(bodies.map((b) => b.bot)).toEqual(bots);
    const heard: (string | null)[] = [];
    for (let i = 0; i < bots.length; i++) {
      heard.push(player.get().key);
      audios[i].onended?.();
      await settle();
    }
    expect(heard).toEqual(bots.map((b) => `m-${b}`));
    expect(player.get()).toMatchObject({ key: null, phase: 'idle' });
  });

  it('pauses briefly between bubbles, and not before the first', async () => {
    const { player, audios, waits } = setup([]);
    player.queue('a', 'One.');
    player.queue('b', 'Two.');
    await settle();
    expect(waits).toEqual([]);
    audios[0].onended?.();
    await settle();
    expect(waits).toEqual([BUBBLE_GAP_MS]);
    expect(BUBBLE_GAP_MS).toBeLessThanOrEqual(400);
  });

  it('skips a bubble whose audio failed, keeps its note, and reads the next', async () => {
    const { player, audios } = setup([async () => audioResponse(), async () => refusal(502, 'failed', 'Fish sent no audio.')]);
    player.queue('a', 'One.');
    player.queue('b', 'Two.');
    player.queue('c', 'Three.');
    await settle();
    audios[0].onended?.();
    await settle();
    expect(audios).toHaveLength(2);
    expect(player.get()).toMatchObject({ key: 'c', phase: 'playing', notes: { b: 'Fish sent no audio.' } });
  });

  it('stop drops what is queued, and a later press does not fetch a stopped bubble again', async () => {
    const second = later();
    const { player, sent, audios } = setup([async () => audioResponse(), second.next]);
    player.queue('a', 'One.');
    player.queue('b', 'Two.');
    await settle();
    player.stop();
    second.answer();
    await settle();
    expect(audios).toHaveLength(1);
    expect(player.get()).toMatchObject({ key: null, phase: 'idle' });
    player.playList([
      { key: 'a', text: 'One.' },
      { key: 'b', text: 'Two.' },
    ]);
    await settle();
    audios[1].onended?.();
    await settle();
    expect(sent).toEqual(['One.', 'Two.']);
    expect(audios).toHaveLength(3);
    expect(player.get()).toMatchObject({ key: 'b', phase: 'playing' });
  });

  it('asks again on a press after the route refused, since nothing was spent', async () => {
    const { player, sent } = setup([async () => refusal(502, 'failed', 'Fish sent no audio.')]);
    player.play('a', 'One.');
    await settle();
    player.play('a', 'One.');
    await settle();
    expect(sent).toEqual(['One.', 'One.']);
    expect(player.get()).toMatchObject({ key: 'a', phase: 'playing' });
  });
});

describe('bubbleVoice (plan #3043)', () => {
  it('follows the queue from bubble to bubble, and greys a bubble the browser held back', async () => {
    let refuse = true;
    const { player, audios } = setup([], async () => {
      if (refuse) {
        refuse = false;
        throw new Error('NotAllowedError');
      }
    });
    player.queue('a', 'One.');
    player.queue('b', 'Two.');
    expect(bubbleVoice(player.get(), 'a')).toBe('loading');
    await settle();
    // The first was held back, so the second plays and the first waits for a press.
    expect(bubbleVoice(player.get(), 'a')).toBe('blocked');
    expect(bubbleVoice(player.get(), 'b')).toBe('playing');
    audios[1].onended?.();
    await settle();
    expect(bubbleVoice(player.get(), 'b')).toBe('rest');
    // A press on the grey one plays it, and it is no longer blocked.
    player.play('a', 'One.');
    await settle();
    expect(bubbleVoice(player.get(), 'a')).toBe('playing');
    player.stop();
    expect(bubbleVoice(player.get(), 'a')).toBe('rest');
  });
});

describe('playing means sounding (plan #3068)', () => {
  function reporting(responses: (() => Promise<Response>)[], play: () => Promise<void> = async () => {}) {
    const failures: SpeechFailure[] = [];
    const audios: SpeechAudio[] = [];
    const player = createSpeechPlayer({
      wait: async () => {},
      fetch: () => (responses.shift() ?? (() => Promise.resolve(audioResponse())))(),
      audio: () => {
        const audio: SpeechAudio = { play: vi.fn(play), pause: vi.fn(), onended: null, onerror: null };
        audios.push(audio);
        return { audio, release: () => {} };
      },
      report: (failure) => failures.push(failure),
    });
    return { player, failures, audios };
  }

  it('keeps the pill down until the audio says it sounds', async () => {
    let sound: () => void = () => {};
    const { player } = reporting([], () => new Promise<void>((resolve) => (sound = resolve)));
    player.play('a', 'Hello.');
    await settle();
    expect(player.get().phase).toBe('loading');
    expect(pillShows(player.get())).toBe(false);
    sound();
    await settle();
    expect(player.get().phase).toBe('playing');
    expect(pillShows(player.get())).toBe(true);
  });

  it('keeps the pill up between the bubbles of a run once one has sounded, and down when the run ends', async () => {
    const { player, audios } = reporting([]);
    player.queue('a', 'One.');
    player.queue('b', 'Two.');
    await settle();
    audios[0].onended?.();
    expect(player.get()).toMatchObject({ key: 'b', phase: 'loading' });
    expect(pillShows(player.get())).toBe(true);
    await settle();
    audios[1].onended?.();
    expect(pillShows(player.get())).toBe(false);
  });

  it('never shows the pill for a reply the browser held back, and logs the error name', async () => {
    const held = Object.assign(new Error('StalledError: the clock did not move'), { name: 'StalledError' });
    const { player, failures } = reporting([], () => Promise.reject(held));
    player.play('a', 'Hello.');
    await settle();
    expect(pillShows(player.get())).toBe(false);
    expect(player.get().notes.a).toBe(SPEAK_HELD_BACK);
    expect(failures).toEqual([{ stage: 'play', key: 'a', name: 'StalledError', message: 'StalledError: the clock did not move' }]);
  });

  it("logs the route's status and why when voice is paused or not set up", async () => {
    const { player, failures } = reporting([() => Promise.resolve(refusal(429, 'paused', 'Voice is paused until next month.'))]);
    player.play('a', 'Hello.');
    await settle();
    await settle();
    expect(player.get().notes.a).toBe('Voice is paused until next month.');
    expect(failures).toEqual([{ stage: 'fetch', key: 'a', status: 429, why: 'paused' }]);
  });

  it('counts an empty body as not read aloud', async () => {
    const empty = () => Promise.resolve(new Response(new Blob([], { type: 'audio/mpeg' }), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }));
    const { player, failures, audios } = reporting([empty]);
    player.play('a', 'Hello.');
    await settle();
    await settle();
    expect(audios).toHaveLength(0);
    expect(player.get().notes.a).toBe(SPEAK_UNREACHABLE);
    expect(failures[0]).toMatchObject({ stage: 'fetch', why: 'empty body' });
  });

  it('shows the play press when the sound stops part way, and reads the next bubble', async () => {
    const { player, failures, audios } = reporting([]);
    player.queue('a', 'One.');
    player.queue('b', 'Two.');
    await settle();
    audios[0].onerror?.(true);
    expect(player.get().notes.a).toBe(SPEAK_HELD_BACK);
    expect(failures).toEqual([{ stage: 'playback', key: 'a', name: 'Interrupted' }]);
    await settle();
    expect(player.get()).toMatchObject({ key: 'b', phase: 'playing' });
  });
});

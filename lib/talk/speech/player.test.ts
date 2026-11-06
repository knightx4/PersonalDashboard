import { describe, expect, it, vi } from 'vitest';
import { createSpeechPlayer, SPEAK_HELD_BACK, SPEAK_UNREACHABLE, type SpeechAudio } from './player';

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
  const player = createSpeechPlayer({
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
  return { player, sent, audios, released };
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
    expect(sent).toEqual(['First.']);
    audios[0].onended?.();
    await settle();
    expect(sent).toEqual(['First.', 'Second.']);
    expect(player.get()).toMatchObject({ key: 'b', phase: 'playing' });
    audios[1].onended?.();
    player.speakOnce('b', 'Second.');
    await settle();
    expect(sent).toHaveLength(2);
  });

  it('stops what is playing and empties the queue', async () => {
    const { player, sent, audios } = setup([]);
    player.queue('a', 'First.');
    player.queue('b', 'Second.');
    await settle();
    player.stop();
    expect(audios[0].pause).toHaveBeenCalled();
    expect(player.get()).toMatchObject({ key: null, phase: 'idle' });
    audios[0].onended?.();
    await settle();
    expect(sent).toEqual(['First.']);
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
});

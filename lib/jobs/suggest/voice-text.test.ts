import { describe, expect, it } from 'vitest';
import { pickVoiceSamples, voiceSample, VOICE_SAMPLES } from './voice-text';

const body = 'Hey Sam, thanks for sending that over. I had a look and the second model is the one I would run with, mostly because the cash timing holds up.';

describe('voiceSample', () => {
  it('keeps what they wrote and drops the quoted thread and the signature', () => {
    const raw = `${body}\n\nBest,\nAlex\n--\nAlex Smith | Acme\n\nOn Mon, 1 Sep 2026 at 09:00, Sam <sam@x.com> wrote:\n> the old message`;
    expect(voiceSample(raw)).toBe(`${body}\n\nBest,\nAlex`);
  });

  it('cuts at a reply header that wraps onto a second line', () => {
    const raw = `${body}\r\n\r\nOn Mon, 1 Sep 2026 at 09:00, Sam Long-Name\r\n<sam@example.com> wrote:\r\n\r\nolder text`;
    expect(voiceSample(raw)).toBe(body);
  });

  it('leaves out mail too short, too long, mostly links or automatic', () => {
    expect(voiceSample('Thanks, sounds good.')).toBeNull();
    expect(voiceSample('word '.repeat(200))).toBeNull();
    expect(voiceSample(`${body} https://a.com https://b.com https://c.com`)).toBeNull();
    expect(voiceSample(`I am out of the office until Monday. ${body}`)).toBeNull();
  });
});

describe('pickVoiceSamples', () => {
  it('takes repeats out and stops at the limit', () => {
    const texts = [body, `  ${body}  `, ...Array.from({ length: 10 }, (_, i) => `${body} Number ${i}.`)];
    const out = pickVoiceSamples(texts);
    expect(out).toHaveLength(VOICE_SAMPLES);
    expect(out[0]).toBe(body);
    expect(out[1]).toBe(`${body} Number 0.`);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { plainEnough, scrubSpoken, spokenFor, spokenScriptMessage, type SpokenDeps } from './script';
import { prepareSpeech } from './text';

const LISTY = `Here's where things stand:

- #3050.3.2 file attach is built (see https://dash.example.com/dev/plan/3050)
- #3051 needs your **Fish key** in \`lib/talk/speech/fish.ts\`
- #3052.1 phone test, due 2026-11-09 ✅
- \`todo.tasks:3f2a1b4c-1d2e-4f5a-8b9c-0d1e2f3a4b5c\` closed in a1b2c3d

Four things need you.`;

function deps(over: Partial<SpokenDeps> = {}): SpokenDeps & { kept: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; keep: ReturnType<typeof vi.fn> } {
  return {
    kept: vi.fn(async () => null),
    write: vi.fn(async () => 'Four things need you, mainly a setup key and a phone test.'),
    keep: vi.fn(async () => {}),
    ...over,
  } as never;
}

describe('scrubSpoken', () => {
  it('reads no outline, address, path, ref, hash or emoji, and makes each list item a sentence', () => {
    const said = scrubSpoken(LISTY);
    expect(said).not.toMatch(/#|\d{4}\.|3050|3051|https?:|example\.com|\/|\.ts\b|3f2a|a1b2c3d|✅|\*|`|\(|\)/);
    expect(said).toContain('file attach is built.');
    expect(said).toContain('needs your Fish key.');
    expect(said).toContain('Four things need you.');
    expect(said.split('\n')).toHaveLength(1);
  });

  it('takes "plan" with an outline, and keeps the words around it', () => {
    expect(scrubSpoken('I finished plan #3079 and #3080.1 today.')).toBe('I finished and today.');
    expect(scrubSpoken('Built the voice step (#3079.2).')).toBe('Built the voice step.');
  });

  it('leaves plain speech and a word pair like and/or alone', () => {
    expect(scrubSpoken('Yes, call them and/or write back on Friday.')).toBe('Yes, call them and/or write back on Friday.');
  });

  it('keeps to the limit at a sentence', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    expect(Array.from(scrubSpoken(long, 120)).length).toBeLessThanOrEqual(120);
  });

  it('is empty when nothing but refs is left', () => {
    expect(scrubSpoken('#3050.3.2 https://example.com/x `lib/a/b.ts`')).toBe('');
  });
});

describe('plainEnough', () => {
  it('spares a short plain bubble the rewrite', () => {
    expect(plainEnough("On it, I'll tell you when it's done.")).toBe(true);
  });

  it('sends a bubble with numbers, outlines, addresses or a list to be rewritten', () => {
    expect(plainEnough('Three steps shipped.')).toBe(true);
    expect(plainEnough('3 steps shipped.')).toBe(false);
    expect(plainEnough('Shipped #3050.')).toBe(false);
    expect(plainEnough('See https://example.com')).toBe(false);
    expect(plainEnough(LISTY)).toBe(false);
    expect(plainEnough('word '.repeat(60))).toBe(false);
  });
});

describe('spokenFor', () => {
  it('writes a short script for a listy bubble, scrubs it and keeps it', async () => {
    const d = deps({ write: vi.fn(async () => '"Four things need you (#3051, #3052.1), mainly a key and a phone test 📱."') });
    const said = await spokenFor(LISTY, d);
    expect(said).toEqual({ text: 'Four things need you, mainly a key and a phone test.', source: 'written' });
    expect(d.write).toHaveBeenCalledWith(LISTY);
    expect(d.keep).toHaveBeenCalledWith('Four things need you, mainly a key and a phone test.');
  });

  it('uses the kept script on a second hearing without asking the model', async () => {
    const d = deps({ kept: vi.fn(async () => 'Four things need you.') });
    expect(await spokenFor(LISTY, d)).toEqual({ text: 'Four things need you.', source: 'kept' });
    expect(d.write).not.toHaveBeenCalled();
    expect(d.keep).not.toHaveBeenCalled();
  });

  it('speaks a short plain bubble as it is, with no call', async () => {
    const d = deps();
    expect(await spokenFor('Sure, on it now.', d)).toEqual({ text: 'Sure, on it now.', source: 'plain' });
    expect(d.write).not.toHaveBeenCalled();
  });

  it('falls back to the bubble as before when the rewrite fails, and keeps nothing', async () => {
    const d = deps({ write: vi.fn(async () => null) });
    const said = await spokenFor(LISTY, d);
    expect(said).toEqual({ text: LISTY, source: 'fallback' });
    expect(d.keep).not.toHaveBeenCalled();
    // The route then speaks it the way it always has.
    expect(prepareSpeech(said.text).text).toContain('Four things need you.');
  });

  it('falls back when the rewrite throws or says nothing worth hearing', async () => {
    expect((await spokenFor(LISTY, deps({ write: vi.fn(async () => { throw new Error('timed out'); }) }))).source).toBe('fallback');
    expect((await spokenFor(LISTY, deps({ write: vi.fn(async () => '#3050 https://example.com') }))).source).toBe('fallback');
  });

  it('writes a new script when the kept one cannot be read', async () => {
    const d = deps({ kept: vi.fn(async () => { throw new Error('down'); }) });
    expect((await spokenFor(LISTY, d)).source).toBe('written');
  });
});

describe('spokenScriptMessage', () => {
  it('gives the model today and the bubble', () => {
    expect(spokenScriptMessage('Hi', 'Sunday 8 November 2026')).toBe('Today is Sunday 8 November 2026.\n\nThe message:\n\nHi');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { bytesLeft, MONTHLY_BYTE_CAP, speechCostMicros, speechMonth } from './budget';
import { speakReply, type SpeakDeps } from './speak';
import type { FishResult } from './fish';

const AUDIO = new Uint8Array([1, 2, 3]).buffer;

function deps(over: Partial<SpeakDeps> = {}): SpeakDeps & { used: () => number } {
  let used = 0;
  const base: SpeakDeps = {
    configured: true,
    month: '2026-11-01',
    reserve: vi.fn(async (_month: string, bytes: number, cap: number) => {
      if (used + bytes > cap) return null;
      used += bytes;
      return used;
    }),
    release: vi.fn(async (_month: string, bytes: number) => {
      used -= bytes;
    }),
    synthesize: vi.fn(async (): Promise<FishResult> => ({ ok: true, audio: AUDIO })),
    recordSpend: vi.fn(async () => {}),
  };
  return Object.assign(base, over, { used: () => used });
}

describe('speakReply', () => {
  it('sends the cleaned reply, counts its bytes and records the spend', async () => {
    const d = deps();
    const out = await speakReply('**Done.** See [the list](https://x.y).', d);
    expect(out).toMatchObject({ ok: true, bytes: 19, monthBytes: 19, cap: MONTHLY_BYTE_CAP, trimmed: false });
    expect(d.synthesize).toHaveBeenCalledWith('Done. See the list.');
    expect(d.recordSpend).toHaveBeenCalledWith(19);
  });

  it('sends nothing to Fish once the month would pass the cap, and says voice is paused', async () => {
    const d = deps({ cap: 30 });
    expect((await speakReply('Twenty characters...', d)).ok).toBe(true);
    const out = await speakReply('Twenty characters...', d);
    expect(out).toMatchObject({ ok: false, why: 'paused', status: 429 });
    expect(d.synthesize).toHaveBeenCalledTimes(1);
    expect(d.used()).toBe(20);
  });

  it('sends nothing without the key', async () => {
    const d = deps({ configured: false });
    expect(await speakReply('Hello there.', d)).toMatchObject({ ok: false, why: 'not-set', status: 503 });
    expect(d.reserve).not.toHaveBeenCalled();
    expect(d.synthesize).not.toHaveBeenCalled();
  });

  it('sends nothing when nothing is left to read', async () => {
    const d = deps();
    expect(await speakReply('https://example.com', d)).toMatchObject({ ok: false, why: 'empty' });
    expect(d.reserve).not.toHaveBeenCalled();
  });

  it('takes the reservation back when Fish sends no audio', async () => {
    const d = deps({ synthesize: vi.fn(async (): Promise<FishResult> => ({ ok: false, why: 'credit', detail: '402' })) });
    expect(await speakReply('Hello there.', d)).toMatchObject({ ok: false, why: 'credit', status: 402 });
    expect(d.release).toHaveBeenCalledWith('2026-11-01', 12);
    expect(d.used()).toBe(0);
    expect(d.recordSpend).not.toHaveBeenCalled();
  });

  it('trims a long reply to the limit before counting it', async () => {
    const d = deps({ limit: 50 });
    const out = await speakReply(`${'word '.repeat(100)}`, d);
    expect(out).toMatchObject({ ok: true, trimmed: true });
    if (out.ok) expect(out.bytes).toBeLessThanOrEqual(52);
  });
});

describe('budget', () => {
  it('stops the month at $4.95', () => {
    expect(speechCostMicros(MONTHLY_BYTE_CAP)).toBe(4_950_000);
  });

  it('starts the month on the 1st', () => {
    expect(speechMonth('2026-11-30')).toBe('2026-11-01');
    expect(() => speechMonth('November')).toThrow();
  });

  it('never has less than nothing left', () => {
    expect(bytesLeft(400_000)).toBe(0);
    expect(bytesLeft(30_000)).toBe(300_000);
  });
});

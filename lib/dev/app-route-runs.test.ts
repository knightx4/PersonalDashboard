import { describe, expect, it } from 'vitest';
import { bytesWords, tookWords } from './app-route-runs';

describe('bytesWords', () => {
  it('reads sizes in the unit a person scans', () => {
    expect(bytesWords(0)).toBe('0 B');
    expect(bytesWords(840)).toBe('840 B');
    expect(bytesWords(1240)).toBe('1.2 KB');
    expect(bytesWords(48_000)).toBe('48 KB');
    expect(bytesWords(1_250_000)).toBe('1.3 MB');
  });
});

describe('tookWords', () => {
  const start = '2026-11-08T10:00:00Z';
  it('is empty while the run has not ended', () => {
    expect(tookWords(start, null)).toBeNull();
  });
  it('reads milliseconds, seconds and minutes', () => {
    expect(tookWords(start, '2026-11-08T10:00:00.450Z')).toBe('450 ms');
    expect(tookWords(start, '2026-11-08T10:00:12Z')).toBe('12 s');
    expect(tookWords(start, '2026-11-08T10:04:05Z')).toBe('4 min 5 s');
    expect(tookWords(start, '2026-11-08T10:05:00Z')).toBe('5 min');
  });
});

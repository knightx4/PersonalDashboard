import { describe, expect, it } from 'vitest';
import { isValidTimeZone, normalizeTimeZone, safeTimeZone } from './timezone';

describe('normalizeTimeZone', () => {
  it('accepts a real IANA zone', () => {
    expect(normalizeTimeZone('Europe/London')).toBe('Europe/London');
    expect(normalizeTimeZone('America/New_York')).toBe('America/New_York');
  });

  it('translates the abbreviations people actually type', () => {
    // The one that took the review queue down.
    expect(normalizeTimeZone('ET')).toBe('America/New_York');
    expect(normalizeTimeZone('PT')).toBe('America/Los_Angeles');
    expect(normalizeTimeZone('GMT')).toBe('Europe/London');
    expect(normalizeTimeZone('bst')).toBe('Europe/London');
  });

  it('maps to a region rather than a fixed offset, so DST still applies', () => {
    // `EST` is itself a valid IANA id, but the legacy fixed-offset one that
    // never observes daylight saving. Taking it at face value would put
    // somebody in New York an hour out all summer, on interview times.
    const zone = normalizeTimeZone('EST')!;
    expect(zone).toBe('America/New_York');

    // Asserted as an offset rather than a name: en-GB renders short zone names
    // as "GMT-4" rather than "EDT". The offset is the thing that matters.
    const at = (iso: string) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(iso));

    expect(at('2026-07-01T12:00:00Z')).toBe('08'); // EDT, UTC-4
    expect(at('2026-01-01T12:00:00Z')).toBe('07'); // EST, UTC-5
  });

  it('canonicalises casing so one zone is one value', () => {
    expect(normalizeTimeZone('europe/london')).toBe('Europe/London');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeTimeZone('  Europe/London  ')).toBe('Europe/London');
  });

  it('refuses something that is not a zone at all', () => {
    // Better a rejected write than a value that reads as UTC forever.
    expect(normalizeTimeZone('my desk')).toBeNull();
    expect(normalizeTimeZone('Mars/Olympus_Mons')).toBeNull();
    expect(normalizeTimeZone('')).toBeNull();
    expect(normalizeTimeZone(null)).toBeNull();
  });
});

describe('safeTimeZone', () => {
  it('never returns something Intl will throw on', () => {
    for (const value of ['ET', 'Europe/London', 'nonsense', '', null, undefined]) {
      const zone = safeTimeZone(value);
      expect(() => new Intl.DateTimeFormat('en-GB', { timeZone: zone })).not.toThrow();
    }
  });

  it('falls back to UTC rather than taking the page down', () => {
    expect(safeTimeZone('nonsense')).toBe('UTC');
  });

  it('still repairs a value it recognises', () => {
    expect(safeTimeZone('ET')).toBe('America/New_York');
  });
});

describe('isValidTimeZone', () => {
  it('separates real zones from invented ones', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    expect(isValidTimeZone('ET')).toBe(false);
  });
});
